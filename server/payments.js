// Integração com Mercado Pago (opcional).
// Credenciais ficam SOMENTE em variáveis de ambiente no servidor, nunca no navegador:
//   MP_ACCESS_TOKEN   – token de produção da conta Mercado Pago da loja
//   MP_WEBHOOK_SECRET – assinatura secreta das notificações (painel do Mercado Pago > Webhooks)
//   PUBLIC_URL        – endereço público do site (ex.: https://supremoacai.com.br)
// Um pagamento só é marcado como APROVADO depois que o servidor consulta a API do
// Mercado Pago e recebe status "approved". O conteúdo da notificação nunca é confiado sozinho.
const crypto = require('crypto');

const MP_API = 'https://api.mercadopago.com';
const token = () => process.env.MP_ACCESS_TOKEN || '';
const enabled = () => Boolean(token());

async function mpFetch(path, opts = {}) {
  const res = await fetch(MP_API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Mercado Pago respondeu ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// PIX dinâmico (QR Code gerado pelo Mercado Pago, confirmação automática)
async function createPixPayment(order) {
  const body = {
    transaction_amount: order.total / 100,
    description: `Pedido ${order.code} - Supremo Açaí`,
    payment_method_id: 'pix',
    external_reference: order.code,
    notification_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/api/payments/webhook/mercadopago` : undefined,
    // O Mercado Pago exige um e-mail de pagador; usamos o e-mail da loja definido no servidor.
    payer: { email: process.env.MP_PAYER_EMAIL, first_name: order.customer_name }
  };
  const p = await mpFetch('/v1/payments', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'X-Idempotency-Key': `pix-${order.code}` }
  });
  return {
    id: String(p.id),
    status: p.status,
    qr_code: p.point_of_interaction?.transaction_data?.qr_code,
    qr_code_base64: p.point_of_interaction?.transaction_data?.qr_code_base64
  };
}

// Cartão online: Checkout Pro (página segura do Mercado Pago; o site nunca recebe dados do cartão)
async function createCardCheckout(order, items) {
  const base = process.env.PUBLIC_URL || '';
  const pref = await mpFetch('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ title: `Pedido ${order.code} - Supremo Açaí`, quantity: 1, unit_price: order.total / 100, currency_id: 'BRL' }],
      external_reference: order.code,
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }] },
      back_urls: base ? {
        success: `${base}/pedido.html?c=${order.code}`,
        pending: `${base}/pedido.html?c=${order.code}`,
        failure: `${base}/pedido.html?c=${order.code}`
      } : undefined,
      auto_return: base ? 'approved' : undefined,
      notification_url: base ? `${base}/api/payments/webhook/mercadopago` : undefined
    })
  });
  return { id: pref.id, init_point: pref.init_point };
}

async function getPayment(id) {
  return mpFetch(`/v1/payments/${encodeURIComponent(id)}`);
}

// Validação da assinatura x-signature do Mercado Pago
function verifyWebhookSignature(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(sig.split(',').map(s => s.trim().split('=')));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch { return false; }
}

module.exports = { enabled, createPixPayment, createCardCheckout, getPayment, verifyWebhookSignature };
