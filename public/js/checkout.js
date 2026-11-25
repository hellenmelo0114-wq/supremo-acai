(async function () {
  const S = window.Supremo; const $ = S.$;
  const c = await S.ready;
  const form = $('#form');
  if (!S.cart.items().length) { form.hidden = true; $('#emptyCart').hidden = false; return; }

  // dados salvos de pedidos anteriores (somente neste aparelho)
  try {
    const saved = JSON.parse(localStorage.getItem('supremo_customer') || '{}');
    for (const k of ['customer_name', 'customer_phone', 'address', 'address_ref']) if (saved[k]) form.elements[k].value = saved[k];
  } catch { /* ignore */ }

  $('#feeLabel').textContent = c.delivery_fee ? `Taxa ${S.money(c.delivery_fee)}` : 'Entrega grátis';
  if (c.delivery_enabled === false) { $('#optDelivery').hidden = true; $('#m-pick').checked = true; }
  if (c.pickup_enabled === false) $('#optPickup').hidden = true;
  $('#pickupBox').textContent = `Retire na loja: ${c.address || ''}`;

  const opts = [['pix', 'PIX', c.pix_on_site ? 'Na entrega/retirada' : 'Pague pelo app do banco'], ['cash', 'Dinheiro', 'Na entrega/retirada'], ['credit', 'Cartão de crédito', c.online_payment ? 'Online ou na maquininha' : 'Na maquininha'], ['debit', 'Cartão de débito', c.online_payment ? 'Online ou na maquininha' : 'Na maquininha']]
    .filter(([k]) => c.payments?.[k] !== false);
  $('#payments').innerHTML = opts.map(([k, l, s], i) => `<div class="choice"><input type="radio" name="payment_method" value="${k}" id="p-${k}" ${i === 0 ? 'checked' : ''}><label for="p-${k}">${l}<small>${s}</small></label></div>`).join('');

  function mode() { return form.elements.mode.value; }
  function refresh() {
    const isDel = mode() === 'delivery';
    $('#addressBox').hidden = !isDel; $('#pickupBox').hidden = isDel;
    const pm = form.elements.payment_method.value;
    $('#changeBox').hidden = pm !== 'cash';
    const hint = $('#payHint');
    hint.hidden = pm !== 'pix' || c.pix_on_site;
    if (pm === 'pix') hint.textContent = 'Após confirmar, você verá o código PIX para pagamento. O pedido é considerado pago somente após a confirmação do recebimento.';
    const items = S.cart.items();
    $('#items').innerHTML = items.map(i => `<div class="cart-item" style="padding:10px 0"><h4 style="font-size:.95rem">${i.quantity}x ${S.esc(i.name)}${i.size_name ? ` · ${S.esc(i.size_name)}` : ''}</h4>
      <strong>${S.money(i.unit_price * i.quantity)}</strong>${i.addons.length || i.notes ? `<div class="meta">${i.addons.map(a => S.esc(a.name)).join(', ')}${i.notes ? ` — ${S.esc(i.notes)}` : ''}</div>` : ''}</div>`).join('')
      + `<p style="margin:8px 0 0"><button type="button" class="link-btn" style="color:var(--brand)" data-open-cart>Editar carrinho</button></p>`;
    const sub = S.cart.subtotal(); const fee = isDel ? (c.delivery_fee || 0) : 0;
    $('#totals').innerHTML = `<div><span>Produtos</span><span>${S.money(sub)}</span></div>
      <div><span>Taxa de entrega</span><span>${isDel ? S.money(fee) : 'Grátis (retirada)'}</span></div>
      <div class="grand"><span>Total</span><span>${S.money(sub + fee)}</span></div>`;
    if (c.store_open === false) { $('#err').hidden = false; $('#err').textContent = `Estamos fechados agora. ${c.opening_hours ? 'Nosso horário: ' + c.opening_hours + '.' : ''} Você pode montar o pedido e enviar quando abrirmos.`; $('#submit').disabled = true; }
  }
  form.addEventListener('change', refresh);
  window.addEventListener('storage', refresh);
  document.addEventListener('click', (e) => { if (e.target.closest('#cartDrawer button')) setTimeout(() => { if (!S.cart.items().length) location.reload(); else refresh(); }, 0); });
  refresh();

  // máscara simples de telefone
  form.elements.customer_phone.addEventListener('input', (e) => {
    let d = e.target.value.replace(/\D/g, '').slice(0, 11);
    e.target.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#err'); err.hidden = true;
    const f = form.elements;
    const problems = [];
    if (f.customer_name.value.trim().length < 2) problems.push('Informe seu nome.');
    if (f.customer_phone.value.replace(/\D/g, '').length < 10) problems.push('Informe um WhatsApp válido com DDD.');
    if (mode() === 'delivery' && f.address.value.trim().length < 8) problems.push('Informe o endereço completo.');
    if (problems.length) { err.hidden = false; err.textContent = problems.join(' '); return; }
    const btn = $('#submit'); btn.disabled = true; btn.textContent = 'Enviando pedido…';
    const body = {
      customer_name: f.customer_name.value, customer_phone: f.customer_phone.value, mode: mode(),
      address: f.address.value, address_ref: f.address_ref.value, payment_method: f.payment_method.value,
      change_for: f.payment_method.value === 'cash' ? f.change_for.value : null, notes: f.notes.value,
      items: S.cart.items().map(i => ({ product_id: i.product_id, size_id: i.size_id, quantity: i.quantity, addons: i.addons.map(a => a.id), notes: i.notes }))
    };
    try {
      const order = await S.api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
      try {
        localStorage.setItem('supremo_customer', JSON.stringify({ customer_name: body.customer_name, customer_phone: body.customer_phone, address: body.address, address_ref: body.address_ref }));
        const hist = JSON.parse(localStorage.getItem('supremo_orders') || '[]'); hist.unshift({ code: order.code, number: order.number, at: order.created_at });
        localStorage.setItem('supremo_orders', JSON.stringify(hist.slice(0, 10)));
      } catch { /* ignore */ }
      S.cart.clear();
      location.href = `/pedido.html?c=${order.code}&novo=1`;
    } catch (ex) {
      err.hidden = false; err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Confirmar pedido';
    }
  });
})();
