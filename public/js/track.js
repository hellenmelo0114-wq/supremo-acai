(async function () {
  const S = window.Supremo; const $ = S.$;
  const c = await S.ready;
  const params = new URLSearchParams(location.search);
  const code = (params.get('c') || '').toUpperCase();
  const isNew = params.get('novo') === '1';

  if (!code) {
    $('#lookup').hidden = false;
    try {
      const hist = JSON.parse(localStorage.getItem('supremo_orders') || '[]');
      if (hist.length) $('#recent').innerHTML = `<h3 style="margin-top:22px;font-size:1rem">Seus pedidos recentes neste aparelho</h3>` +
        hist.map(h => `<p><a href="/pedido.html?c=${S.esc(h.code)}">Pedido #${h.number} · ${S.esc(h.code)}</a> <small style="color:var(--muted)">${S.esc(h.at || '')}</small></p>`).join('');
    } catch { /* ignore */ }
    $('#lookupForm').onsubmit = (e) => { e.preventDefault(); location.href = '/pedido.html?c=' + encodeURIComponent($('#codeIn').value.trim().toUpperCase()); };
    return;
  }

  const FLOW = ['received', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
  const LABELS = { received: 'Pedido recebido', confirmed: 'Pedido confirmado', preparing: 'Em preparação', out_for_delivery: 'Saiu para entrega', delivered: 'Pedido entregue' };
  const HINT = { received: 'A loja está analisando seu pedido.', confirmed: 'Seu pedido foi aceito!', preparing: 'Estamos preparando tudo com carinho.', out_for_delivery: 'O entregador está a caminho.', delivered: 'Bom apetite! 💜' };
  let pixLoaded = false; let lastStatus = null;

  function render(o) {
    const labels = { ...LABELS };
    if (o.mode !== 'delivery') { labels.out_for_delivery = 'Pronto para retirada'; labels.delivered = 'Pedido retirado'; }
    const idx = FLOW.indexOf(o.status);
    const final = ['cancelled', 'rejected'].includes(o.status);
    const when = Object.fromEntries(o.history.map(h => [h.status, h.at]));
    const payBadge = o.payment_status === 'paid' ? '<span class="pay-badge paid">Pagamento confirmado</span>'
      : o.payment_status === 'failed' ? '<span class="pay-badge failed">Pagamento não aprovado</span>'
      : `<span class="pay-badge pending">${o.payment_method === 'pix' && !c.pix_on_site ? 'Aguardando confirmação do PIX' : 'Pagar na ' + (o.mode === 'delivery' ? 'entrega' : 'retirada')}</span>`;
    $('#view').hidden = false;
    $('#view').innerHTML = `
      <div class="track-head">
        ${isNew ? '<div class="alert ok" style="display:inline-block">Pedido enviado com sucesso! Guarde este link para acompanhar.</div>' : ''}
        <h1 style="font-size:clamp(1.6rem,4vw,2.2rem);margin-top:10px">Pedido #${o.number}</h1>
        <p>Código: <span class="code">${S.esc(o.code)}</span> <button class="link-btn" style="color:var(--brand)" id="copyLink">Copiar link</button></p>
      </div>
      <div class="checkout">
        <div style="display:grid;gap:18px">
          <div class="panel">
            ${final ? `<div class="alert"><strong>${o.status === 'rejected' ? 'Pedido recusado' : 'Pedido cancelado'}</strong>${o.cancel_reason ? ` — ${S.esc(o.cancel_reason)}` : ''}<br>Em caso de dúvida, fale conosco pelo WhatsApp.</div>`
              : `<ol class="steps">${FLOW.map((s, i) => `<li class="${i < idx || o.status === 'delivered' ? 'done' : i === idx ? 'current' : ''}">
                <span class="dot">${i < idx || o.status === 'delivered' ? '✓' : i + 1}</span>
                <div><h4>${labels[s]}</h4><small>${when[s] ? when[s].slice(11, 16) + ' · ' : ''}${i === idx ? (o.mode !== 'delivery' && s === 'out_for_delivery' ? 'Pode vir buscar!' : HINT[s]) : ''}</small></div></li>`).join('')}</ol>`}
            <p style="font-size:.8rem;color:var(--muted);margin:18px 0 0" id="live">● Atualização automática</p>
          </div>
          <div class="panel" id="payPanel">
            <h2>Pagamento</h2>
            <p>${S.PAY[o.payment_method]}${o.change_for ? ` · troco para ${S.money(o.change_for)}` : ''} &nbsp; ${payBadge}</p>
            <div id="payArea"></div>
          </div>
        </div>
        <aside class="panel">
          <h2>Resumo</h2>
          ${o.items.map(i => `<div class="cart-item" style="padding:10px 0"><h4 style="font-size:.95rem">${i.quantity}x ${S.esc(i.product_name)}${i.size_name ? ` · ${S.esc(i.size_name)}` : ''}</h4>
            <strong>${S.money(i.total)}</strong>${i.addons.length || i.notes ? `<div class="meta">${i.addons.map(S.esc).join(', ')}${i.notes ? ` — ${S.esc(i.notes)}` : ''}</div>` : ''}</div>`).join('')}
          <div class="totals"><div><span>Produtos</span><span>${S.money(o.subtotal)}</span></div>
            <div><span>Taxa de entrega</span><span>${o.mode === 'delivery' ? S.money(o.delivery_fee) : 'Retirada'}</span></div>
            <div class="grand"><span>Total</span><span>${S.money(o.total)}</span></div></div>
          <p style="font-size:.9rem;color:var(--muted)">${o.mode === 'delivery' ? `Entrega: ${S.esc(o.address)}${o.address_ref ? ` (${S.esc(o.address_ref)})` : ''}` : `Retirada: ${S.esc(c.address || '')}`}</p>
          <a class="btn btn-wa btn-block" target="_blank" rel="noopener" href="${S.waLink(S.orderWhatsappText(o))}">${S.ICONS.wa} Enviar resumo pelo WhatsApp</a>
        </aside>
      </div>`;
    $('#copyLink').onclick = () => { navigator.clipboard?.writeText(`${location.origin}/pedido.html?c=${o.code}`); S.toast('Link copiado!'); };
    renderPayment(o);
    if (lastStatus && lastStatus !== o.status) S.toast(labels[o.status] || 'Pedido atualizado');
    lastStatus = o.status;
  }

  let payCache = null;
  async function renderPayment(o) {
    let area = $('#payArea'); if (!area) return;
    if (o.payment_status === 'paid' || ['cancelled', 'rejected'].includes(o.status)) { area.innerHTML = ''; return; }
    if (o.payment_method === 'pix') {
      if (!payCache) {
        try {
          payCache = await S.api(`/api/orders/${o.code}/pix`);
          if (payCache.provider === 'mercadopago') {
            const p = await S.api(`/api/orders/${o.code}/pay`, { method: 'POST' });
            payCache = { provider: 'mercadopago', payload: p.qr_code, qr: p.qr_code_base64 ? 'data:image/png;base64,' + p.qr_code_base64 : null };
          }
        } catch (e) { const a2 = $('#payArea'); if (a2) a2.innerHTML = `<div class="alert">${S.esc(e.message)}</div>`; return; }
      }
      area = $('#payArea'); if (!area) return;
      const p = payCache;
      if (p.provider === 'on_site') { area.innerHTML = `<div class="alert info">O PIX é pago no momento da ${o.mode === 'delivery' ? 'entrega' : 'retirada'}: a loja mostra a chave ou o QR Code na hora.</div>`; return; }
      if (!p.payload) { area.innerHTML = `<div class="alert info">${S.esc(p.message || 'A loja enviará os dados do PIX pelo WhatsApp.')}</div>`; return; }
      area.innerHTML = `<div class="pix-box">
        <p style="margin-top:0"><strong>Pague ${S.money(o.total)} com PIX</strong></p>
        ${p.qr ? `<img src="${p.qr}" alt="QR Code PIX" width="220" height="220" style="margin:0 auto 12px;border-radius:12px;background:#fff">` : ''}
        <label class="sr-only" for="pixCode">PIX copia e cola</label>
        <textarea id="pixCode" class="pix-code" rows="4" readonly>${S.esc(p.payload)}</textarea>
        <button class="btn btn-brand btn-block" id="copyPix" style="margin-top:10px">Copiar código PIX</button>
        ${p.receiver_name ? `<p style="font-size:.85rem;color:var(--muted)">Recebedor: ${S.esc(p.receiver_name)}${p.key ? ` · Chave: ${S.esc(p.key)}` : ''}</p>` : ''}
        ${p.instructions ? `<p style="font-size:.85rem">${S.esc(p.instructions)}</p>` : ''}
        <p style="font-size:.85rem;color:var(--muted)">${p.provider === 'mercadopago' ? 'A confirmação é automática assim que o banco aprovar.' : 'Após pagar, envie o comprovante pelo WhatsApp. O pagamento aparece como confirmado quando a loja conferir o recebimento.'}</p>
      </div>`;
      area.querySelector('#copyPix').onclick = () => { navigator.clipboard?.writeText(p.payload); S.toast('Código PIX copiado!'); };
    } else if (['credit', 'debit'].includes(o.payment_method) && c.online_payment) {
      area.innerHTML = `<p style="color:var(--muted)">Pague na maquininha na ${o.mode === 'delivery' ? 'entrega' : 'retirada'} ou online, em ambiente seguro do Mercado Pago.</p>
        <button class="btn btn-brand" id="payOnline">Pagar online com cartão</button>`;
      area.querySelector('#payOnline').onclick = async () => {
        try { const r = await S.api(`/api/orders/${o.code}/pay`, { method: 'POST' }); if (r.redirect) location.href = r.redirect; } catch (e) { S.toast(e.message); }
      };
    } else area.innerHTML = '';
  }

  let lastJson = '';
  async function load() {
    try {
      const o = await S.api('/api/orders/' + encodeURIComponent(code));
      const j = JSON.stringify(o);
      if (j !== lastJson) { lastJson = j; render(o); }
      return true;
    }
    catch (e) { $('#lookup').hidden = false; $('#lookupErr').hidden = false; $('#lookupErr').textContent = e.message; $('#codeIn').value = code;
      $('#lookupForm').onsubmit = (ev) => { ev.preventDefault(); location.href = '/pedido.html?c=' + encodeURIComponent($('#codeIn').value.trim().toUpperCase()); }; return false; }
  }
  if (!(await load())) return;

  // atualização automática (a cada 8 s com a página aberta)
  setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load().catch(() => {}); });
})();
