process.env.TZ = process.env.TZ || 'America/Bahia';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const dbmod = require('./db');
const { db, tx, init, allSettings, setSetting, getSetting, audit, exportAll, DATA_DIR, REMOTE, DEFAULT_SETTINGS } = require('./db');
const auth = require('./auth');
const { requireAuth, requirePerm, can } = auth;
const orders = require('./orders');
const { httpError, nowLocal, today } = orders;
const analytics = require('./analytics');
const exporter = require('./export');
const { buildPixPayload } = require('./pix');
const mp = require('./payments');
const QRCode = require('qrcode');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN); // fotos no Vercel Blob em produção
if (!USE_BLOB && !process.env.VERCEL) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Express 4 não captura erros de funções assíncronas: encaminha para o tratador de erros
const Layer = require('express/lib/router/layer');
const origHandle = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return origHandle.call(this, req, res, next);
  try { const r = fn(req, res, next); if (r && typeof r.catch === 'function') r.catch(next); } catch (e) { next(e); }
};

// Prepara o banco (tabelas + cardápio inicial) antes da primeira requisição
let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = (async () => {
    await init();
    if (process.env.SEED_MENU !== '0' && await require('./cardapio-inicial').seedMenuIfEmpty()) console.log('Cardápio inicial cadastrado.');
  })().catch(e => { readyPromise = null; throw e; });
  return readyPromise;
}

// ---------- Segurança: cabeçalhos ----------
app.use(async (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'",
    "base-uri 'self'", "form-action 'self'"
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(express.json({ limit: '200kb' }));
// Diagnóstico (não mostra senhas): ajuda a conferir a configuração na Vercel
app.get('/api/health', async (req, res) => {
  const out = {
    ok: false,
    banco: dbmod.REMOTE ? 'Turso (nuvem)' : (dbmod.ON_VERCEL ? 'NÃO CONFIGURADO' : 'arquivo local'),
    banco_endereco: dbmod.TURSO_URL ? dbmod.TURSO_URL.replace(/^(libsql:\/\/[^.]{0,6}).*/, '$1…') : null,
    variaveis: {
      TURSO_DATABASE_URL: Boolean(process.env.TURSO_DATABASE_URL), TURSO_AUTH_TOKEN: Boolean(process.env.TURSO_AUTH_TOKEN),
      BLOB_READ_WRITE_TOKEN: Boolean(process.env.BLOB_READ_WRITE_TOKEN)
    }
  };
  try {
    await ready();
    out.produtos = (await db.prepare('SELECT COUNT(*) n FROM products').get()).n;
    out.categorias = (await db.prepare('SELECT COUNT(*) n FROM categories').get()).n;
    out.usuarios = (await db.prepare('SELECT COUNT(*) n FROM users').get()).n;
    out.ok = true;
  } catch (e) { out.erro = e.message; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.ok ? 200 : 503).json(out);
});
app.use(['/api', '/sitemap.xml'], async (req, res, next) => { await ready(); next(); });

// Proteção CSRF: chamadas que alteram dados no painel precisam do cabeçalho próprio do site
app.use(['/api/admin', '/api/auth'], async (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'supremo') return res.status(403).json({ error: 'Requisição bloqueada.' });
  next();
});

// Limite simples por IP
function rateLimit(max, windowMs) {
  const hits = new Map();
  return async (req, res, next) => {
    const k = req.ip; const now = Date.now();
    const h = (hits.get(k) || []).filter(t => now - t < windowMs);
    if (h.length >= max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    h.push(now); hits.set(k, h); next();
  };
}

const wrap = (fn) => async (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };
const cents = (v) => { const n = Math.round(Number(String(v ?? '').replace(',', '.')) * 100); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

// ======================================================================
// ÁREA PÚBLICA
// ======================================================================
async function publicConfig() {
  const s = await allSettings();
  const pay = {};
  for (const k of ['pix', 'cash', 'credit', 'debit']) pay[k] = s.payments[k]?.enabled !== false;
  return {
    store_name: s.store_name, slogan: s.slogan, address: s.address, city: s.city, state: s.state,
    whatsapp: s.whatsapp, whatsapp_display: s.whatsapp_display, service_info: s.service_info, opening_hours: s.opening_hours,
    store_open: s.store_open && orders.withinHours(s), store_enabled: s.store_open, open_time: s.open_time, close_time: s.close_time,
    pix_on_site: s.payments.pix?.on_site !== false, delivery_enabled: s.delivery_enabled, pickup_enabled: s.pickup_enabled,
    delivery_fee: s.delivery_fee, min_order: s.min_order, logo: s.logo, hero_images: s.hero_images || [], brand_colors: s.brand_colors,
    payments: pay, online_payment: mp.enabled()
  };
}
app.get('/api/public/config', async (req, res) => res.json(await publicConfig()));

async function menuData(includeInactive = false) {
  const promos = await orders.activePromotions();
  const cats = await db.prepare(`SELECT * FROM categories ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`).all();
  const prods = await db.prepare(`SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`).all();
  const sizes = await db.prepare(`SELECT * FROM product_sizes ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`).all();
  const groups = await db.prepare(`SELECT * FROM addon_groups ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY id`).all();
  const addons = await db.prepare(`SELECT * FROM addons ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`).all();
  const links = await db.prepare('SELECT * FROM product_addon_groups').all();
  const groupMap = Object.fromEntries(groups.map(g => [g.id, { ...g, addons: addons.filter(a => a.group_id === g.id) }]));
  const products = prods.map(p => {
    const ps = sizes.filter(s => s.product_id === p.id).map(s => ({ ...s, promo_price: orders.promoPrice(p.id, s.price, promos).price }));
    const pr = orders.promoPrice(p.id, p.price, promos);
    return {
      ...p, sizes: ps, promo_price: pr.price, promo: pr.promo ? { title: pr.promo.title } : null,
      addon_groups: links.filter(l => l.product_id === p.id).map(l => groupMap[l.group_id]).filter(Boolean)
    };
  });
  return {
    categories: cats.map(c => ({ ...c, products: products.filter(p => p.category_id === c.id) })),
    uncategorized: products.filter(p => !p.category_id || !cats.find(c => c.id === p.category_id)),
    promotions: promos.map(p => ({ id: p.id, title: p.title, description: p.description, image: p.image, product_id: p.product_id, discount_type: p.discount_type, discount_value: p.discount_value, ends_at: p.ends_at }))
  };
}
app.get('/api/public/menu', async (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.json(await menuData()); });

// Pedido do cliente
app.post('/api/orders', rateLimit(15, 10 * 60e3), wrap(async (req, res) => {
  const order = await orders.createOrder(req.body, { channel: 'online' });
  res.status(201).json(orders.publicOrder(order));
}));

const mpLastCheck = new Map();
async function refreshProviderPayment(order) {
  if (!mp.enabled() || order.payment_provider !== 'mercadopago' || order.payment_status === 'paid' || !order.payment_ref) return order;
  const last = mpLastCheck.get(order.id) || 0;
  if (Date.now() - last < 15e3) return order;
  mpLastCheck.set(order.id, Date.now());
  try {
    // payment_ref pode ser id de pagamento (PIX) — consulta direta na API do provedor
    if (/^\d+$/.test(order.payment_ref)) {
      const p = await mp.getPayment(order.payment_ref);
      if (p.status === 'approved' && p.external_reference === order.code && Math.round(p.transaction_amount * 100) === order.total) {
        return await orders.markPaid(order.id, 'Mercado Pago', String(p.id));
      }
    }
  } catch (e) { console.error('Falha ao consultar pagamento:', e.message); }
  return order;
}

app.get('/api/orders/:code', wrap(async (req, res) => {
  let o = await orders.getOrderByCode(req.params.code);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado. Confira o código.' });
  o = await refreshProviderPayment(o);
  res.setHeader('Cache-Control', 'no-store');
  res.json(orders.publicOrder(o));
}));

// Dados de pagamento PIX do pedido
app.get('/api/orders/:code/pix', wrap(async (req, res) => {
  const o = await orders.getOrderByCode(req.params.code);
  if (!o || o.payment_method !== 'pix') return res.status(404).json({ error: 'Pedido não encontrado.' });
  const s = await allSettings();
  const pix = s.payments.pix || {};
  // Com Mercado Pago configurado, o QR Code dinâmico é obtido em POST /api/orders/:code/pay
  if (mp.enabled()) return res.json({ provider: 'mercadopago' });
  if (pix.on_site !== false) return res.json({ provider: 'on_site' });
  if (!pix.key) return res.json({ provider: 'manual', payload: null, message: 'A chave PIX será informada pela loja no WhatsApp.' });
  const payload = buildPixPayload({ key: pix.key, keyType: pix.key_type, name: pix.receiver_name || s.store_name, city: pix.receiver_city || s.city, amountCents: o.total, txid: o.code });
  const qr = await QRCode.toDataURL(payload, { margin: 1, width: 280 });
  res.json({ provider: 'static', payload, qr, key: pix.key, receiver_name: pix.receiver_name, instructions: pix.instructions, amount: o.total });
}));

// Inicia pagamento online (somente se o Mercado Pago estiver configurado no servidor)
app.post('/api/orders/:code/pay', rateLimit(20, 10 * 60e3), wrap(async (req, res) => {
  if (!mp.enabled()) return res.status(400).json({ error: 'Pagamento online não configurado.' });
  const o = await orders.getOrderByCode(req.params.code);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (o.payment_status === 'paid') return res.json({ paid: true });
  if (['cancelled', 'rejected'].includes(o.status)) return res.status(400).json({ error: 'Pedido cancelado.' });
  if (o.payment_method === 'pix') {
    const p = await mp.createPixPayment(o);
    await db.prepare("UPDATE orders SET payment_provider = 'mercadopago', payment_ref = ? WHERE id = ?").run(p.id, o.id);
    return res.json({ provider: 'mercadopago', qr_code: p.qr_code, qr_code_base64: p.qr_code_base64 });
  }
  if (o.payment_method === 'credit' || o.payment_method === 'debit') {
    const pref = await mp.createCardCheckout(o);
    await db.prepare("UPDATE orders SET payment_provider = 'mercadopago' WHERE id = ?").run(o.id);
    return res.json({ provider: 'mercadopago', redirect: pref.init_point });
  }
  res.status(400).json({ error: 'Forma de pagamento paga na entrega.' });
}));

// Notificação do Mercado Pago — confirma SOMENTE após consulta ao provedor
app.post('/api/payments/webhook/mercadopago', wrap(async (req, res) => {
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const type = req.query.type || req.body?.type;
  if (!dataId || type !== 'payment') return res.sendStatus(200);
  if (process.env.MP_WEBHOOK_SECRET && !mp.verifyWebhookSignature(req, dataId)) return res.sendStatus(401);
  if (!mp.enabled()) return res.sendStatus(200);
  const p = await mp.getPayment(dataId);
  const o = await orders.getOrderByCode(p.external_reference);
  if (o && p.status === 'approved' && Math.round(p.transaction_amount * 100) === o.total) {
    await db.prepare("UPDATE orders SET payment_provider = 'mercadopago' WHERE id = ?").run(o.id);
    await orders.markPaid(o.id, 'Mercado Pago', String(p.id));
    await audit(null, 'payment.confirmed_provider', 'order', o.id, { provider: 'mercadopago', payment_id: String(p.id) });
  } else if (o && ['rejected', 'cancelled'].includes(p.status) && o.payment_status === 'pending') {
    await db.prepare("UPDATE orders SET payment_status = 'failed' WHERE id = ?").run(o.id);
  }
  res.sendStatus(200);
}));

// ======================================================================
// AUTENTICAÇÃO
// ======================================================================
const userCount = async () => (await db.prepare('SELECT COUNT(*) n FROM users').get()).n;
app.get('/api/auth/setup-needed', async (req, res) => res.json({ needed: await userCount() === 0 }));

app.post('/api/auth/setup', rateLimit(5, 15 * 60e3), wrap(async (req, res) => {
  if (await userCount() > 0) return res.status(400).json({ error: 'O sistema já foi configurado.' });
  const { name, username, password } = req.body || {};
  const err = auth.validatePassword(password);
  if (err) return res.status(400).json({ error: err });
  if (!str(name) || !/^[a-zA-Z0-9._-]{3,30}$/.test(username || '')) return res.status(400).json({ error: 'Informe nome e um usuário (3 a 30 letras/números).' });
  const r = await db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?, 'owner')").run(str(name, 80), username, auth.hashPassword(password));
  const user = { id: Number(r.lastInsertRowid), name: str(name, 80), role: 'owner' };
  await audit(user, 'user.setup_owner', 'user', user.id, null, req.ip);
  auth.setSessionCookie(res, await auth.createSession(user.id), req);
  res.json({ ok: true });
}));

app.post('/api/auth/login', rateLimit(20, 15 * 60e3), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const key = `${req.ip}|${String(username).toLowerCase()}`;
  if (!auth.loginAllowed(key)) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em 15 minutos.' });
  const u = await db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!u || !u.active || !auth.verifyPassword(String(password || ''), u.password_hash)) {
    auth.loginFailed(key);
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  auth.loginOk(key);
  await audit(u, 'user.login', 'user', u.id, null, req.ip);
  auth.setSessionCookie(res, await auth.createSession(u.id), req);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', async (req, res) => {
  await auth.destroySession(auth.parseCookies(req)[auth.COOKIE]);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const perms = ['dashboard', 'orders', 'products', 'stock', 'movements', 'recipes', 'finance', 'cash', 'suppliers', 'purchases', 'employees', 'reports.operational', 'reports.financial', 'settings', 'audit']
    .filter(p => can(req.user, p));
  res.json({ user: { ...req.user, role_label: auth.ROLE_LABELS[req.user.role] }, permissions: perms });
});

app.post('/api/auth/password', requireAuth, wrap(async (req, res) => {
  const { current, next: nextPw } = req.body || {};
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!auth.verifyPassword(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta.' });
  const err = auth.validatePassword(nextPw);
  if (err) return res.status(400).json({ error: err });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(nextPw), u.id);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  auth.setSessionCookie(res, await auth.createSession(u.id), req);
  await audit(req.user, 'user.change_password', 'user', u.id, null, req.ip);
  res.json({ ok: true });
}));

// ======================================================================
// PAINEL ADMINISTRATIVO
// ======================================================================
const admin = express.Router();
admin.use(requireAuth);
app.use('/api/admin', admin);
const A = async (req, action, entity, id, details) => audit(req.user, action, entity, id, details, req.ip);

// ----- Dashboard -----
admin.get('/dashboard', requirePerm('dashboard'), async (req, res) => {
  const { from, to } = analytics.resolvePeriod(req.query);
  const k = await analytics.kpis(from, to);
  const financial = can(req.user, 'reports.financial');
  if (!financial) { delete k.profit_estimate; delete k.expenses_total; delete k.expenses_operational; delete k.cmv; delete k.other_income; }
  res.json({
    from, to, kpis: k, financial,
    top: await analytics.productRanking(from, to, 8, 'DESC'),
    bottom: await analytics.productRanking(from, to, 8, 'ASC'),
    charts: await analytics.charts(from, to),
    alerts: (await analytics.alerts()).filter(a => financial || !['bill', 'expense', 'cash'].includes(a.type)),
    low_stock: await db.prepare('SELECT id, name, quantity, min_quantity, unit FROM stock_items WHERE active = 1 AND quantity <= min_quantity ORDER BY quantity LIMIT 20').all()
  });
});

// ----- Pedidos -----
admin.get('/orders', requirePerm('orders'), async (req, res) => {
  const where = []; const params = [];
  if (req.query.status === 'open') where.push("status IN ('received','confirmed','preparing','out_for_delivery')");
  else if (req.query.status && orders.STATUS_LABELS[req.query.status]) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.from) { where.push('date(created_at) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(created_at) <= ?'); params.push(req.query.to); }
  if (req.query.q) {
    const q = `%${String(req.query.q).slice(0, 50)}%`;
    where.push('(customer_name LIKE ? OR customer_phone LIKE ? OR code LIKE ? OR CAST(id AS TEXT) = ?)'); params.push(q, q, q, String(req.query.q).replace('#', ''));
  }
  const limit = Math.min(200, int(req.query.limit) || 100);
  const rows = await db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...params, limit);
  const ids = rows.map(o => o.id);
  const items = ids.length ? await db.prepare(`SELECT order_id, product_name, size_name, quantity, addons, notes FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  res.json(rows.map(o => ({ ...o, items: items.filter(i => i.order_id === o.id).map(i => ({ ...i, addons: JSON.parse(i.addons) })) })));
});
admin.get('/orders/:id', requirePerm('orders'), async (req, res) => {
  const o = await orders.getOrder(int(req.params.id));
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json(o);
});
admin.post('/orders/:id/status', requirePerm('orders'), wrap(async (req, res) => {
  const { status, reason, ingredientsLost, confirmPayment } = req.body || {};
  res.json(await orders.changeStatus(int(req.params.id), status, req.user, { reason: str(reason, 300), ingredientsLost: bool(ingredientsLost), confirmPayment: bool(confirmPayment) }));
}));
admin.post('/orders/:id/confirm-payment', requirePerm('orders'), wrap(async (req, res) => {
  const o = await orders.getOrder(int(req.params.id));
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  await A(req, 'payment.confirmed_manual', 'order', o.id, { method: o.payment_method, total: o.total });
  res.json(await orders.markPaid(o.id, `${req.user.name} (conferência manual)`));
}));
// Venda de balcão / presencial
admin.post('/orders', requirePerm('orders'), wrap(async (req, res) => {
  const body = req.body || {};
  const order = await orders.createOrder({ ...body, customer_name: str(body.customer_name, 80) || 'Cliente balcão' }, { channel: 'balcao', user: req.user });
  let result = order;
  if (bool(body.finish_now)) result = await orders.changeStatus(order.id, 'delivered', req.user, { confirmPayment: true });
  res.status(201).json(result);
}));
admin.post('/store-open', requirePerm('orders'), wrap(async (req, res) => {
  await setSetting('store_open', bool(req.body.open));
  await A(req, 'settings.store_open', 'settings', null, { open: bool(req.body.open) });
  res.json({ store_open: bool(req.body.open) });
}));

// ----- Catálogo: categorias, produtos, adicionais, promoções -----
admin.get('/catalog', requirePerm('products', 'recipes', 'orders'), async (req, res) => {
  const m = await menuData(true);
  const allAddons = await db.prepare('SELECT * FROM addons ORDER BY sort, id').all();
  res.json({ ...m, addon_groups: (await db.prepare('SELECT * FROM addon_groups ORDER BY id').all()).map(g => ({ ...g, addons: allAddons.filter(a => a.group_id === g.id) })),
    promotions_all: await db.prepare('SELECT * FROM promotions ORDER BY id DESC').all() });
});

admin.post('/categories', requirePerm('products'), wrap(async (req, res) => {
  const name = str(req.body.name, 60); if (!name) throw httpError(400, 'Informe o nome da categoria.');
  const r = await db.prepare('INSERT INTO categories (name, sort, active) VALUES (?,?,?)').run(name, int(req.body.sort) || 0, req.body.active === false ? 0 : 1);
  await A(req, 'category.create', 'category', Number(r.lastInsertRowid), { name });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
admin.put('/categories/:id', requirePerm('products'), wrap(async (req, res) => {
  const id = int(req.params.id); const name = str(req.body.name, 60); if (!name) throw httpError(400, 'Informe o nome.');
  await db.prepare('UPDATE categories SET name = ?, sort = ?, active = ? WHERE id = ?').run(name, int(req.body.sort) || 0, req.body.active === false ? 0 : 1, id);
  await A(req, 'category.update', 'category', id, req.body);
  res.json({ ok: true });
}));
admin.delete('/categories/:id', requirePerm('products'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const n = (await db.prepare('SELECT COUNT(*) n FROM products WHERE category_id = ?').get(id)).n;
  if (n) throw httpError(400, 'Esta categoria tem produtos. Mova-os ou desative a categoria.');
  await db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  await A(req, 'category.delete', 'category', id);
  res.json({ ok: true });
}));

async function saveProduct(req, id) {
  const b = req.body || {};
  const name = str(b.name, 100); if (!name) throw httpError(400, 'Informe o nome do produto.');
  const sizes = Array.isArray(b.sizes) ? b.sizes.filter(s => str(s.name)) : [];
  const price = cents(b.price);
  if (!sizes.length && price <= 0) throw httpError(400, 'Informe o preço ou cadastre os tamanhos com preço.');
  for (const s of sizes) if (cents(s.price) <= 0) throw httpError(400, `Informe o preço do tamanho "${s.name}".`);
  return tx(async () => {
    const vals = [int(b.category_id), name, str(b.description, 600), b.image ? str(b.image, 300) : null, price, b.active === false ? 0 : 1, bool(b.featured) ? 1 : 0, int(b.sort) || 0];
    if (id) await db.prepare('UPDATE products SET category_id=?, name=?, description=?, image=?, price=?, active=?, featured=?, sort=? WHERE id=?').run(...vals, id);
    else id = Number((await db.prepare('INSERT INTO products (category_id, name, description, image, price, active, featured, sort) VALUES (?,?,?,?,?,?,?,?)').run(...vals)).lastInsertRowid);
    // tamanhos: atualiza existentes, cria novos, desativa removidos (preserva fichas técnicas e histórico)
    const keep = [];
    for (const [i, s] of sizes.entries()) {
      const sid = int(s.id);
      if (sid && await db.prepare('SELECT id FROM product_sizes WHERE id = ? AND product_id = ?').get(sid, id)) {
        await db.prepare('UPDATE product_sizes SET name=?, price=?, sort=?, active=1 WHERE id=?').run(str(s.name, 40), cents(s.price), i, sid); keep.push(sid);
      } else keep.push(Number((await db.prepare('INSERT INTO product_sizes (product_id, name, price, sort) VALUES (?,?,?,?)').run(id, str(s.name, 40), cents(s.price), i)).lastInsertRowid));
    }
    await db.prepare(`UPDATE product_sizes SET active = 0 WHERE product_id = ? ${keep.length ? `AND id NOT IN (${keep.map(() => '?').join(',')})` : ''}`).run(id, ...keep);
    await db.prepare('DELETE FROM product_addon_groups WHERE product_id = ?').run(id);
    for (const g of (b.addon_group_ids || []).map(int).filter(Boolean)) await db.prepare('INSERT OR IGNORE INTO product_addon_groups VALUES (?,?)').run(id, g);
    await A(req, req.params.id ? 'product.update' : 'product.create', 'product', id, { name, price, sizes: sizes.map(s => [s.name, s.price]) });
    return id;
  });
}
admin.post('/products', requirePerm('products'), wrap(async (req, res) => res.status(201).json({ id: await saveProduct(req, null) })));
admin.put('/products/:id', requirePerm('products'), wrap(async (req, res) => res.json({ id: await saveProduct(req, int(req.params.id)) })));
admin.delete('/products/:id', requirePerm('products'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const used = (await db.prepare('SELECT COUNT(*) n FROM order_items WHERE product_id = ?').get(id)).n;
  if (used) { await db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id); await A(req, 'product.deactivate', 'product', id); return res.json({ ok: true, deactivated: true }); }
  await db.prepare('DELETE FROM products WHERE id = ?').run(id);
  await A(req, 'product.delete', 'product', id);
  res.json({ ok: true });
}));

admin.post('/addon-groups', requirePerm('products'), wrap(async (req, res) => res.status(201).json({ id: await saveGroup(req, null) })));
admin.put('/addon-groups/:id', requirePerm('products'), wrap(async (req, res) => res.json({ id: await saveGroup(req, int(req.params.id)) })));
async function saveGroup(req, id) {
  const b = req.body || {};
  const name = str(b.name, 60); if (!name) throw httpError(400, 'Informe o nome do grupo (ex.: Complementos).');
  return tx(async () => {
    const vals = [name, Math.max(0, int(b.min_select) || 0), Math.max(0, int(b.max_select) || 0), b.active === false ? 0 : 1];
    if (id) await db.prepare('UPDATE addon_groups SET name=?, min_select=?, max_select=?, active=? WHERE id=?').run(...vals, id);
    else id = Number((await db.prepare('INSERT INTO addon_groups (name, min_select, max_select, active) VALUES (?,?,?,?)').run(...vals)).lastInsertRowid);
    const keep = [];
    for (const [i, a] of (b.addons || []).filter(a => str(a.name)).entries()) {
      const aid = int(a.id);
      const v = [str(a.name, 60), Math.max(0, cents(a.price)), a.active === false ? 0 : 1, i];
      if (aid && await db.prepare('SELECT id FROM addons WHERE id=? AND group_id=?').get(aid, id)) { await db.prepare('UPDATE addons SET name=?, price=?, active=?, sort=? WHERE id=?').run(...v, aid); keep.push(aid); }
      else keep.push(Number((await db.prepare('INSERT INTO addons (name, price, active, sort, group_id) VALUES (?,?,?,?,?)').run(...v, id)).lastInsertRowid));
    }
    await db.prepare(`UPDATE addons SET active = 0 WHERE group_id = ? ${keep.length ? `AND id NOT IN (${keep.map(() => '?').join(',')})` : ''}`).run(id, ...keep);
    await A(req, 'addon_group.save', 'addon_group', id, { name, addons: (b.addons || []).map(a => [a.name, a.price]) });
    return id;
  });
}

admin.post('/promotions', requirePerm('products'), wrap(async (req, res) => res.status(201).json({ id: await savePromo(req, null) })));
admin.put('/promotions/:id', requirePerm('products'), wrap(async (req, res) => res.json({ id: await savePromo(req, int(req.params.id)) })));
admin.delete('/promotions/:id', requirePerm('products'), wrap(async (req, res) => {
  await db.prepare('UPDATE promotions SET active = 0 WHERE id = ?').run(int(req.params.id));
  await A(req, 'promotion.deactivate', 'promotion', int(req.params.id));
  res.json({ ok: true });
}));
async function savePromo(req, id) {
  const b = req.body || {};
  const title = str(b.title, 100); if (!title) throw httpError(400, 'Informe o título da promoção.');
  const type = ['none', 'percent', 'fixed'].includes(b.discount_type) ? b.discount_type : 'none';
  const value = type === 'percent' ? Math.min(100, Math.max(0, int(b.discount_value) || 0)) : type === 'fixed' ? cents(b.discount_value) : 0;
  if (type !== 'none' && !int(b.product_id)) throw httpError(400, 'Para dar desconto, escolha o produto da promoção.');
  const vals = [title, str(b.description, 400), b.image ? str(b.image, 300) : null, int(b.product_id), type, value,
    str(b.starts_at, 19) ? str(b.starts_at, 19).replace('T', ' ') : null, str(b.ends_at, 19) ? str(b.ends_at, 19).replace('T', ' ') : null, b.active === false ? 0 : 1];
  if (id) await db.prepare('UPDATE promotions SET title=?, description=?, image=?, product_id=?, discount_type=?, discount_value=?, starts_at=?, ends_at=?, active=? WHERE id=?').run(...vals, id);
  else id = Number((await db.prepare('INSERT INTO promotions (title, description, image, product_id, discount_type, discount_value, starts_at, ends_at, active) VALUES (?,?,?,?,?,?,?,?,?)').run(...vals)).lastInsertRowid);
  await A(req, 'promotion.save', 'promotion', id, { title, type, value });
  return id;
}

// ----- Upload de imagens -----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
});
admin.post('/upload', requirePerm('products', 'settings'), upload.single('image'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Envie uma imagem JPG, PNG ou WEBP de até 4 MB.');
  // confere a assinatura real do arquivo (não apenas a extensão)
  const head = req.file.buffer.subarray(0, 12);
  const ext = (head[0] === 0xFF && head[1] === 0xD8) ? '.jpg' : head.subarray(0, 4).toString('hex') === '89504e47' ? '.png'
    : (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') ? '.webp' : null;
  if (!ext) throw httpError(400, 'Arquivo de imagem inválido.');
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  let url;
  if (USE_BLOB) {
    const { put } = require('@vercel/blob');
    url = (await put(`fotos/${name}`, req.file.buffer, { access: 'public', contentType: req.file.mimetype })).url;
  } else if (process.env.VERCEL) {
    throw httpError(500, 'Armazenamento de fotos não configurado (crie o Blob na Vercel).');
  } else {
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.file.buffer);
    url = `/uploads/${name}`;
  }
  await A(req, 'upload.image', 'upload', null, { file: url });
  res.json({ url });
});

// ----- Estoque -----
admin.get('/stock', requirePerm('stock', 'recipes', 'purchases'), async (req, res) => {
  res.json(await db.prepare(`SELECT s.*, f.name AS supplier_name FROM stock_items s LEFT JOIN suppliers f ON f.id = s.supplier_id ORDER BY s.active DESC, s.category, s.name`).all());
});
admin.post('/stock', requirePerm('stock'), wrap(async (req, res) => res.status(201).json({ id: await saveStockItem(req, null) })));
admin.put('/stock/:id', requirePerm('stock'), wrap(async (req, res) => res.json({ id: await saveStockItem(req, int(req.params.id)) })));
async function saveStockItem(req, id) {
  const b = req.body || {};
  const name = str(b.name, 80); const unit = str(b.unit, 10);
  if (!name || !unit) throw httpError(400, 'Informe nome e unidade de medida.');
  return tx(async () => {
    const vals = [name, str(b.category, 40) || 'Ingredientes', unit, Math.max(0, Number(b.min_quantity) || 0), int(b.supplier_id), str(b.expires_at, 10) || null, b.active === false ? 0 : 1];
    if (id) {
      // quantidade e custo NÃO são editados aqui: mudam somente por movimentações registradas
      const before = await db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
      if (!before) throw httpError(404, 'Item não encontrado.');
      await db.prepare('UPDATE stock_items SET name=?, category=?, unit=?, min_quantity=?, supplier_id=?, expires_at=?, active=? WHERE id=?').run(...vals, id);
      if (b.unit_cost !== undefined && b.unit_cost !== '' && cents(b.unit_cost) !== before.unit_cost && can(req.user, 'purchases')) {
        await db.prepare('UPDATE stock_items SET unit_cost = ? WHERE id = ?').run(cents(b.unit_cost), id);
      }
      await A(req, 'stock_item.update', 'stock_item', id, { before: { name: before.name, min: before.min_quantity, cost: before.unit_cost }, after: b });
    } else {
      id = Number((await db.prepare('INSERT INTO stock_items (name, category, unit, min_quantity, supplier_id, expires_at, active, unit_cost) VALUES (?,?,?,?,?,?,?,?)')
        .run(...vals, cents(b.unit_cost))).lastInsertRowid);
      const q = Number(b.quantity) || 0;
      if (q > 0) await orders.addMovement({ itemId: id, direction: 'in', reason: 'ajuste_pos', quantity: q, unitCost: cents(b.unit_cost), note: 'Saldo inicial', user: req.user });
      await A(req, 'stock_item.create', 'stock_item', id, { name, quantity: q });
    }
    return id;
  });
}
const IN_REASONS = ['compra', 'reposicao', 'devolucao', 'ajuste_pos'];
const OUT_REASONS = ['producao', 'perda', 'vencido', 'dano', 'ajuste_neg'];
admin.get('/movements', requirePerm('movements', 'stock'), async (req, res) => {
  const where = []; const p = [];
  if (int(req.query.item_id)) { where.push('m.item_id = ?'); p.push(int(req.query.item_id)); }
  if (req.query.from) { where.push('date(m.created_at) >= ?'); p.push(req.query.from); }
  if (req.query.to) { where.push('date(m.created_at) <= ?'); p.push(req.query.to); }
  if (req.query.direction === 'in' || req.query.direction === 'out') { where.push('m.direction = ?'); p.push(req.query.direction); }
  res.json(await db.prepare(`SELECT m.*, s.name item_name, s.unit, u.name user_name FROM stock_movements m JOIN stock_items s ON s.id = m.item_id
    LEFT JOIN users u ON u.id = m.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 500`).all(...p));
});
admin.post('/movements', requirePerm('movements'), wrap(async (req, res) => {
  const b = req.body || {};
  const direction = b.direction === 'in' ? 'in' : 'out';
  if (!(direction === 'in' ? IN_REASONS : OUT_REASONS).includes(b.reason)) throw httpError(400, 'Escolha o tipo da movimentação.');
  if (['ajuste_pos', 'ajuste_neg', 'perda', 'dano', 'vencido'].includes(b.reason) && !str(b.note)) throw httpError(400, 'Informe o motivo/observação para ajustes e perdas.');
  const unitCost = b.unit_cost !== undefined && b.unit_cost !== '' ? cents(b.unit_cost) : null;
  const balance = await tx(async () => {
    const bal = await orders.addMovement({ itemId: int(b.item_id), direction, reason: b.reason, quantity: Number(String(b.quantity).replace(',', '.')), unitCost, note: str(b.note, 300), user: req.user });
    if (str(b.expires_at, 10)) await db.prepare('UPDATE stock_items SET expires_at = ? WHERE id = ?').run(str(b.expires_at, 10), int(b.item_id));
    return bal;
  });
  await A(req, 'stock.movement', 'stock_item', int(b.item_id), { direction, reason: b.reason, quantity: b.quantity });
  res.status(201).json({ balance });
}));

// ----- Fichas técnicas -----
admin.get('/recipes', requirePerm('recipes'), async (req, res) => {
  res.json(await db.prepare(`SELECT r.*, s.name item_name, s.unit, s.unit_cost FROM recipes r JOIN stock_items s ON s.id = r.stock_item_id`).all());
});
admin.put('/recipes/:kind/:id', requirePerm('recipes'), wrap(async (req, res) => {
  const id = int(req.params.id); const kind = req.params.kind;
  if (!['product', 'addon'].includes(kind)) throw httpError(400, 'Tipo inválido.');
  const lines = (req.body.lines || []).filter(l => int(l.stock_item_id) && Number(l.quantity) > 0);
  await tx(async () => {
    await db.prepare(`DELETE FROM recipes WHERE ${kind}_id = ?`).run(id);
    for (const l of lines) {
      if (kind === 'product') await db.prepare('INSERT INTO recipes (product_id, size_id, stock_item_id, quantity) VALUES (?,?,?,?)').run(id, int(l.size_id), int(l.stock_item_id), Number(l.quantity));
      else await db.prepare('INSERT INTO recipes (addon_id, stock_item_id, quantity) VALUES (?,?,?)').run(id, int(l.stock_item_id), Number(l.quantity));
    }
  });
  await A(req, 'recipe.save', kind, id, { lines });
  res.json({ ok: true });
}));

// ----- Fornecedores e compras -----
admin.get('/suppliers', requirePerm('suppliers', 'purchases', 'stock'), async (req, res) => {
  res.json(await db.prepare(`SELECT s.*,
    (SELECT COALESCE(SUM(amount),0) FROM finance_entries f WHERE f.supplier_id = s.id AND f.type='expense' AND f.status='paid') paid_total,
    (SELECT COALESCE(SUM(amount),0) FROM finance_entries f WHERE f.supplier_id = s.id AND f.type='expense' AND f.status='open') pending_total,
    (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND p.status != 'cancelled') purchases_count
    FROM suppliers s ORDER BY s.active DESC, s.name`).all());
});
admin.post('/suppliers', requirePerm('suppliers'), wrap(async (req, res) => res.status(201).json({ id: await saveSupplier(req, null) })));
admin.put('/suppliers/:id', requirePerm('suppliers'), wrap(async (req, res) => res.json({ id: await saveSupplier(req, int(req.params.id)) })));
async function saveSupplier(req, id) {
  const b = req.body || {}; const name = str(b.name, 100); if (!name) throw httpError(400, 'Informe o nome do fornecedor.');
  const vals = [name, str(b.phone, 20), str(b.whatsapp, 20).replace(/\D/g, ''), str(b.products, 400), str(b.notes, 400), b.active === false ? 0 : 1];
  if (id) await db.prepare('UPDATE suppliers SET name=?, phone=?, whatsapp=?, products=?, notes=?, active=? WHERE id=?').run(...vals, id);
  else id = Number((await db.prepare('INSERT INTO suppliers (name, phone, whatsapp, products, notes, active) VALUES (?,?,?,?,?,?)').run(...vals)).lastInsertRowid);
  await A(req, 'supplier.save', 'supplier', id, { name });
  return id;
}
admin.get('/purchases', requirePerm('purchases', 'suppliers'), async (req, res) => {
  const where = int(req.query.supplier_id) ? 'WHERE p.supplier_id = ?' : '';
  const rows = await db.prepare(`SELECT p.*, s.name supplier_name, u.name user_name,
    (SELECT status FROM finance_entries f WHERE f.purchase_id = p.id AND f.status != 'cancelled' LIMIT 1) finance_status
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id ${where} ORDER BY p.id DESC LIMIT 300`)
    .all(...(where ? [int(req.query.supplier_id)] : []));
  const allItems = await db.prepare('SELECT pi.*, s.name item_name, s.unit FROM purchase_items pi JOIN stock_items s ON s.id = pi.stock_item_id').all();
  res.json(rows.map(r => ({ ...r, items: allItems.filter(i => i.purchase_id === r.id) })));
});
admin.post('/purchases', requirePerm('purchases'), wrap(async (req, res) => {
  const b = req.body || {};
  const items = (b.items || []).filter(i => int(i.stock_item_id) && Number(i.quantity) > 0);
  if (!items.length) throw httpError(400, 'Adicione pelo menos um item à compra.');
  const id = await tx(async () => {
    const total = items.reduce((s, i) => s + Math.round(Number(i.quantity) * cents(i.unit_cost)), 0);
    const pid = Number((await db.prepare('INSERT INTO purchases (supplier_id, total, due_date, invoice, notes, user_id) VALUES (?,?,?,?,?,?)')
      .run(int(b.supplier_id), total, str(b.due_date, 10) || null, str(b.invoice, 60), str(b.notes, 300), req.user.id)).lastInsertRowid);
    for (const i of items) await db.prepare('INSERT INTO purchase_items (purchase_id, stock_item_id, quantity, unit_cost, expires_at) VALUES (?,?,?,?,?)')
      .run(pid, int(i.stock_item_id), Number(i.quantity), cents(i.unit_cost), str(i.expires_at, 10) || null);
    return pid;
  });
  await A(req, 'purchase.create', 'purchase', id, { supplier_id: b.supplier_id, items: items.length });
  if (bool(b.receive_now)) await receivePurchase(req, id, bool(b.paid_now));
  res.status(201).json({ id });
}));
async function receivePurchase(req, id, paidNow) {
  return tx(async () => {
    const p = await db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
    if (!p) throw httpError(404, 'Compra não encontrada.');
    if (p.status !== 'pending') throw httpError(400, 'Esta compra já foi recebida ou cancelada.');
    const items = await db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id);
    for (const i of items) {
      await orders.addMovement({ itemId: i.stock_item_id, direction: 'in', reason: 'compra', quantity: i.quantity, unitCost: i.unit_cost, note: `Compra nº ${id}`, purchaseId: id, user: req.user });
      if (i.expires_at) await db.prepare('UPDATE stock_items SET expires_at = ? WHERE id = ?').run(i.expires_at, i.stock_item_id);
      if (p.supplier_id) await db.prepare('UPDATE stock_items SET supplier_id = COALESCE(supplier_id, ?) WHERE id = ?').run(p.supplier_id, i.stock_item_id);
    }
    await db.prepare("UPDATE purchases SET status = 'received', received_at = ?, received_by = ? WHERE id = ?").run(nowLocal(), req.user.id, id);
    const sup = p.supplier_id ? await db.prepare('SELECT name FROM suppliers WHERE id = ?').get(p.supplier_id) : null;
    await db.prepare(`INSERT INTO finance_entries (type, category, description, amount, competence_date, due_date, paid_at, status, purchase_id, supplier_id, user_id)
      VALUES ('expense','Compra de mercadorias',?,?,?,?,?,?,?,?,?)`).run(`Compra nº ${id}${sup ? ' — ' + sup.name : ''}`, p.total, today(),
      p.due_date || today(), paidNow ? nowLocal() : null, paidNow ? 'paid' : 'open', id, p.supplier_id, req.user.id);
    await A(req, 'purchase.receive', 'purchase', id, { total: p.total, paid: paidNow });
  });
}
admin.post('/purchases/:id/receive', requirePerm('purchases', 'stock'), wrap(async (req, res) => { await receivePurchase(req, int(req.params.id), bool(req.body.paid_now) && can(req.user, 'finance')); res.json({ ok: true }); }));
admin.post('/purchases/:id/cancel', requirePerm('purchases'), wrap(async (req, res) => {
  const r = await db.prepare("UPDATE purchases SET status = 'cancelled', notes = notes || ? WHERE id = ? AND status = 'pending'").run(` [Cancelada: ${str(req.body.reason, 200)}]`, int(req.params.id));
  if (!r.changes) throw httpError(400, 'Só compras ainda não recebidas podem ser canceladas. Para corrigir, registre um ajuste de estoque.');
  await A(req, 'purchase.cancel', 'purchase', int(req.params.id), { reason: req.body.reason });
  res.json({ ok: true });
}));

// ----- Financeiro -----
const INCOME_CATS = ['Vendas delivery', 'Vendas presenciais', 'Vendas retirada', 'Outras receitas'];
const EXPENSE_CATS = ['Compra de mercadorias', 'Pagamento de fornecedores', 'Embalagens', 'Energia', 'Água', 'Internet', 'Funcionários', 'Taxas de cartão', 'Taxas de entrega', 'Aluguel', 'Manutenção', 'Impostos', 'Outras despesas'];
admin.get('/finance', requirePerm('finance'), async (req, res) => {
  const { from, to } = analytics.resolvePeriod({ period: 'custom', from: req.query.from || today().slice(0, 8) + '01', to: req.query.to || today() });
  const entries = await db.prepare(`SELECT f.*, u.name user_name, s.name supplier_name FROM finance_entries f LEFT JOIN users u ON u.id = f.user_id
    LEFT JOIN suppliers s ON s.id = f.supplier_id WHERE (f.competence_date BETWEEN ? AND ?) OR (f.status = 'open' AND f.type = 'expense') ORDER BY COALESCE(f.due_date, f.competence_date) DESC, f.id DESC LIMIT 1000`).all(from, to);
  const sum = async (cond, extra = []) => (await db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM finance_entries WHERE ${cond}`).get(...extra)).v;
  const k = await analytics.kpis(from, to);
  const income = await sum("type='income' AND status != 'cancelled' AND competence_date BETWEEN ? AND ?", [from, to]);
  const received = await sum("type='income' AND status = 'paid' AND date(paid_at) BETWEEN ? AND ?", [from, to]);
  const expenses = await sum("type='expense' AND status != 'cancelled' AND competence_date BETWEEN ? AND ?", [from, to]);
  const paid = await sum("type='expense' AND status = 'paid' AND date(paid_at) BETWEEN ? AND ?", [from, to]);
  const payable = await sum("type='expense' AND status = 'open'");
  const byCat = await db.prepare(`SELECT type, category, SUM(amount) v FROM finance_entries WHERE status != 'cancelled' AND competence_date BETWEEN ? AND ? GROUP BY type, category ORDER BY v DESC`).all(from, to);
  const byMethod = await db.prepare(`SELECT payment_method m, SUM(amount) v FROM finance_entries WHERE type='income' AND status='paid' AND competence_date BETWEEN ? AND ? GROUP BY m`).all(from, to);
  res.json({
    from, to, entries, income_categories: INCOME_CATS, expense_categories: EXPENSE_CATS,
    summary: { revenue: k.revenue, income, received, expenses, paid, payable, balance: received - paid, cmv: k.cmv, expenses_operational: k.expenses_operational, profit_estimate: k.profit_estimate },
    by_category: byCat, by_method: byMethod.map(r => ({ name: orders.PAYMENT_LABELS[r.m] || 'Outros', v: r.v }))
  });
});
admin.post('/finance', requirePerm('finance'), wrap(async (req, res) => {
  const b = req.body || {};
  const type = b.type === 'income' ? 'income' : 'expense';
  const cats = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  if (!cats.includes(b.category)) throw httpError(400, 'Escolha a categoria.');
  const amount = cents(b.amount); if (amount <= 0) throw httpError(400, 'Informe o valor.');
  const paid = bool(b.paid);
  const r = await db.prepare(`INSERT INTO finance_entries (type, category, description, amount, competence_date, due_date, paid_at, status, payment_method, supplier_id, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(type, b.category, str(b.description, 200), amount, str(b.competence_date, 10) || today(), str(b.due_date, 10) || null,
    paid ? nowLocal() : null, paid ? 'paid' : 'open', str(b.payment_method, 10) || null, int(b.supplier_id), req.user.id);
  await A(req, 'finance.create', 'finance', Number(r.lastInsertRowid), { type, category: b.category, amount });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
admin.post('/finance/:id/pay', requirePerm('finance'), wrap(async (req, res) => {
  const r = await db.prepare("UPDATE finance_entries SET status='paid', paid_at=?, payment_method = COALESCE(?, payment_method) WHERE id=? AND status='open'").run(nowLocal(), str(req.body.payment_method, 10) || null, int(req.params.id));
  if (!r.changes) throw httpError(400, 'Lançamento não está em aberto.');
  await A(req, 'finance.pay', 'finance', int(req.params.id));
  res.json({ ok: true });
}));
admin.post('/finance/:id/cancel', requirePerm('finance'), wrap(async (req, res) => {
  const reason = str(req.body.reason, 200); if (!reason) throw httpError(400, 'Informe o motivo da correção/cancelamento.');
  const e = await db.prepare('SELECT * FROM finance_entries WHERE id = ?').get(int(req.params.id));
  if (!e || e.status === 'cancelled') throw httpError(400, 'Lançamento não encontrado ou já cancelado.');
  if (e.order_id) throw httpError(400, 'Receitas de pedidos são corrigidas cancelando o pedido.');
  await db.prepare("UPDATE finance_entries SET status='cancelled', cancel_reason=? WHERE id=?").run(reason, e.id);
  await A(req, 'finance.cancel', 'finance', e.id, { before: e, reason });
  res.json({ ok: true });
}));

// ----- Caixa -----
async function cashSummary(sessionId) {
  const s = await db.prepare('SELECT c.*, u.name opened_by_name, u2.name closed_by_name FROM cash_sessions c JOIN users u ON u.id = c.opened_by LEFT JOIN users u2 ON u2.id = c.closed_by WHERE c.id = ?').get(sessionId);
  if (!s) return null;
  const movs = await db.prepare('SELECT m.*, u.name user_name FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id WHERE session_id = ? ORDER BY m.id').all(sessionId);
  const expected = { cash: s.opening_amount, pix: 0, credit: 0, debit: 0 };
  const totals = { sales: 0, extra_in: 0, withdrawal: 0, sangria: 0 };
  for (const m of movs) {
    const sign = ['withdrawal', 'sangria'].includes(m.type) ? -1 : 1;
    expected[m.method] = (expected[m.method] || 0) + sign * m.amount;
    totals[m.type === 'sale' ? 'sales' : m.type] += m.amount;
  }
  return { ...s, expected: s.expected ? JSON.parse(s.expected) : expected, counted: s.counted ? JSON.parse(s.counted) : null, live_expected: expected, totals, movements: movs };
}
admin.get('/cash/current', requirePerm('cash'), async (req, res) => {
  const s = await db.prepare("SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
  res.json(s ? await cashSummary(s.id) : null);
});
admin.get('/cash/history', requirePerm('cash'), async (req, res) => {
  res.json(await db.prepare(`SELECT c.id, c.opened_at, c.closed_at, c.opening_amount, c.difference, c.status, u.name opened_by_name, u2.name closed_by_name
    FROM cash_sessions c JOIN users u ON u.id = c.opened_by LEFT JOIN users u2 ON u2.id = c.closed_by ORDER BY c.id DESC LIMIT 100`).all());
});
admin.get('/cash/:id', requirePerm('cash'), async (req, res) => res.json(await cashSummary(int(req.params.id))));
admin.post('/cash/open', requirePerm('cash'), wrap(async (req, res) => {
  if (await db.prepare("SELECT id FROM cash_sessions WHERE status='open'").get()) throw httpError(400, 'Já existe um caixa aberto.');
  const r = await db.prepare('INSERT INTO cash_sessions (opened_by, opening_amount, notes) VALUES (?,?,?)').run(req.user.id, Math.max(0, cents(req.body.opening_amount)), str(req.body.notes, 300));
  await A(req, 'cash.open', 'cash', Number(r.lastInsertRowid), { opening: cents(req.body.opening_amount) });
  res.status(201).json(await cashSummary(Number(r.lastInsertRowid)));
}));
admin.post('/cash/movement', requirePerm('cash'), wrap(async (req, res) => {
  const s = await db.prepare("SELECT id FROM cash_sessions WHERE status='open'").get();
  if (!s) throw httpError(400, 'Abra o caixa primeiro.');
  const type = ['extra_in', 'withdrawal', 'sangria'].includes(req.body.type) ? req.body.type : null;
  if (!type) throw httpError(400, 'Tipo inválido.');
  const amount = cents(req.body.amount); if (amount <= 0) throw httpError(400, 'Informe o valor.');
  if (!str(req.body.description)) throw httpError(400, 'Descreva a movimentação.');
  const method = ['cash', 'pix', 'credit', 'debit'].includes(req.body.method) ? req.body.method : 'cash';
  await db.prepare('INSERT INTO cash_movements (session_id, type, method, amount, description, user_id) VALUES (?,?,?,?,?,?)').run(s.id, type, method, amount, str(req.body.description, 200), req.user.id);
  await A(req, 'cash.movement', 'cash', s.id, { type, amount, method });
  res.json(await cashSummary(s.id));
}));
admin.post('/cash/close', requirePerm('cash'), wrap(async (req, res) => {
  const s = await db.prepare("SELECT id FROM cash_sessions WHERE status='open'").get();
  if (!s) throw httpError(400, 'Não há caixa aberto.');
  const sum = await cashSummary(s.id);
  const counted = {}; let diff = 0;
  for (const k of ['cash', 'pix', 'credit', 'debit']) { counted[k] = Math.max(0, cents(req.body.counted?.[k])); diff += counted[k] - (sum.live_expected[k] || 0); }
  await db.prepare("UPDATE cash_sessions SET status='closed', closed_by=?, closed_at=?, expected=?, counted=?, difference=?, notes = TRIM(notes || ' ' || ?) WHERE id=?")
    .run(req.user.id, nowLocal(), JSON.stringify(sum.live_expected), JSON.stringify(counted), diff, str(req.body.notes, 300), s.id);
  await A(req, 'cash.close', 'cash', s.id, { expected: sum.live_expected, counted, difference: diff });
  res.json(await cashSummary(s.id));
}));

// ----- Funcionários e permissões -----
admin.get('/users', requirePerm('employees'), async (req, res) => {
  res.json({ users: await db.prepare('SELECT id, name, username, role, phone, active, created_at FROM users ORDER BY active DESC, name').all(), roles: auth.ROLE_LABELS, permissions: auth.PERMISSIONS });
});
admin.post('/users', requirePerm('employees'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!auth.ROLE_LABELS[b.role]) throw httpError(400, 'Escolha o perfil.');
  if (!str(b.name) || !/^[a-zA-Z0-9._-]{3,30}$/.test(b.username || '')) throw httpError(400, 'Informe nome e usuário (3 a 30 letras/números, sem espaços).');
  const err = auth.validatePassword(b.password); if (err) throw httpError(400, err);
  if (await db.prepare('SELECT id FROM users WHERE username = ?').get(b.username)) throw httpError(400, 'Este usuário já existe.');
  const r = await db.prepare('INSERT INTO users (name, username, password_hash, role, phone) VALUES (?,?,?,?,?)').run(str(b.name, 80), b.username, auth.hashPassword(b.password), b.role, str(b.phone, 20));
  await A(req, 'user.create', 'user', Number(r.lastInsertRowid), { name: b.name, role: b.role });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
admin.put('/users/:id', requirePerm('employees'), wrap(async (req, res) => {
  const id = int(req.params.id); const b = req.body || {};
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id); if (!u) throw httpError(404, 'Usuário não encontrado.');
  if (!auth.ROLE_LABELS[b.role]) throw httpError(400, 'Perfil inválido.');
  const active = b.active === false ? 0 : 1;
  if (u.role === 'owner' && (b.role !== 'owner' || !active)) {
    const owners = (await db.prepare("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1").get()).n;
    if (owners <= 1) throw httpError(400, 'É preciso manter pelo menos uma proprietária ativa.');
  }
  await db.prepare('UPDATE users SET name=?, role=?, phone=?, active=? WHERE id=?').run(str(b.name, 80) || u.name, b.role, str(b.phone, 20), active, id);
  if (b.password) {
    const err = auth.validatePassword(b.password); if (err) throw httpError(400, err);
    await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hashPassword(b.password), id);
  }
  if (!active || b.password) await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  await A(req, 'user.update', 'user', id, { before: { role: u.role, active: u.active }, after: { role: b.role, active }, password_reset: !!b.password });
  res.json({ ok: true });
}));

// ----- Relatórios -----
admin.get('/reports', async (req, res) => {
  res.json(Object.entries(analytics.REPORTS).filter(([, r]) => can(req.user, r.perm)).map(([id, r]) => ({ id, title: r.title })));
});
admin.get('/reports/:type', wrap(async (req, res) => {
  const def = analytics.REPORTS[req.params.type];
  if (!def) throw httpError(404, 'Relatório não encontrado.');
  if (!can(req.user, def.perm)) throw httpError(403, 'Seu perfil não tem acesso a este relatório.');
  const { from, to } = analytics.resolvePeriod({ period: 'custom', from: req.query.from, to: req.query.to });
  const data = await analytics.report(req.params.type, from, to);
  const store = await getSetting('store_name');
  await A(req, 'report.view', 'report', null, { type: req.params.type, from, to, format: req.query.format || 'json' });
  if (req.query.format === 'xlsx') return exporter.toExcel(res, def.title, data, from, to, store);
  if (req.query.format === 'pdf') return exporter.toPdf(res, def.title, data, from, to, store);
  res.json({ title: def.title, from, to, ...data });
}));

// ----- Configurações -----
admin.get('/settings', requirePerm('settings'), async (req, res) => res.json({ ...allSettings(), online_payment_configured: mp.enabled() }));
admin.put('/settings', requirePerm('settings'), wrap(async (req, res) => {
  const b = req.body || {};
  const before = await allSettings();
  const allowed = Object.keys(DEFAULT_SETTINGS);
  for (const k of allowed) {
    if (!(k in b)) continue;
    let v = b[k];
    if (k === 'delivery_fee' || k === 'min_order') v = Math.max(0, cents(v));
    if (k === 'whatsapp') v = String(v).replace(/\D/g, '');
    if (k === 'brand_colors' && v) {
      for (const c of Object.values(v)) if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw httpError(400, 'Cores devem estar no formato #RRGGBB.');
    }
    await setSetting(k, v);
  }
  await A(req, 'settings.update', 'settings', null, { changed: Object.keys(b).filter(k => allowed.includes(k) && JSON.stringify(before[k]) !== JSON.stringify(b[k])) });
  res.json(await allSettings());
}));

// ----- Auditoria e cópias de segurança -----
admin.get('/audit', requirePerm('audit'), async (req, res) => {
  res.json(await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(1000, int(req.query.limit) || 300)));
});
// Cópia de segurança: baixa todos os dados em um arquivo JSON
admin.get('/backup.json', requirePerm('settings'), async (req, res) => {
  const data = await exportAll();
  await A(req, 'backup.download', 'backup', null, {});
  res.setHeader('Content-Disposition', `attachment; filename="supremo-backup-${today()}.json"`);
  res.json(data);
});

// ======================================================================
// ARQUIVOS ESTÁTICOS
// ======================================================================
if (!process.env.VERCEL) app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

app.get('/sitemap.xml', async (req, res) => {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url><url><loc>${base}/cardapio.html</loc></url></urlset>`);
});
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', extensions: ['html'] }));

// ---------- Erros ----------
app.use('/api', async (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? 'Erro interno. Tente novamente.' : err.message });
});

if (require.main === module) {
  ready().then(() => app.listen(PORT, () => console.log(`Supremo Açaí rodando em http://localhost:${PORT}  (painel: /admin/)`)))
    .catch(e => { console.error(e); process.exit(1); });
}
module.exports = app;
