(async function () {
  const S = window.Supremo; const $ = S.$;
  const c = await S.ready;
  const waText = 'Olá! Vim pelo site da Supremo e gostaria de fazer um pedido.';
  for (const id of ['heroWa', 'bandWa']) { const a = $('#' + id); a.href = S.waLink(waText); a.innerHTML = S.ICONS.wa + ' WhatsApp'; }
  if (c.logo) $('#heroLogo').innerHTML = `<img class="hero-logo" src="${S.esc(c.logo)}" alt="${S.esc(c.store_name)}" fetchpriority="high">`;
  $('#feeChip').textContent = c.delivery_fee ? `Taxa de entrega ${S.money(c.delivery_fee)}` : 'Entrega grátis';
  $('#infoDelivery').textContent = c.delivery_enabled === false ? 'Delivery temporariamente indisponível.' : `Entregamos em ${c.city || 'Madre de Deus'}. Taxa de entrega de ${S.money(c.delivery_fee)}.`;
  $('#infoAddress').textContent = (c.address || '') + (c.opening_hours ? ` · ${c.opening_hours}` : '');

  // banner com as fotos oficiais cadastradas no painel
  const imgs = c.hero_images || [];
  if (imgs.length) {
    const hm = $('#heroMedia'); hm.classList.remove('empty'); hm.removeAttribute('aria-hidden');
    hm.innerHTML = imgs.map((src, i) => `<div class="slide ${i === 0 ? 'on' : ''}"><img src="${S.esc(src)}" alt="Produtos Supremo Açaí e Petiscaria" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} width="1000" height="1250"></div>`).join('');
    if (imgs.length > 1) { let k = 0; setInterval(() => { const s = hm.querySelectorAll('.slide'); s[k].classList.remove('on'); k = (k + 1) % s.length; s[k].classList.add('on'); }, 4500); }
  }

  let menu;
  try { menu = await S.api('/api/public/menu'); } catch { menu = { categories: [], promotions: [], uncategorized: [] }; }
  S.indexProducts(menu);
  const all = [...S.productIndex.values()];

  // promoções
  if (menu.promotions.length) {
    $('#promoSection').hidden = false;
    $('#promos').innerHTML = menu.promotions.map(p => {
      const off = p.discount_type === 'percent' ? `${p.discount_value}% OFF` : p.discount_type === 'fixed' ? `${S.money(p.discount_value)} OFF` : 'Oferta';
      const prod = p.product_id ? S.productIndex.get(p.product_id) : null;
      return `<button class="promo" ${prod ? `data-product="${prod.id}"` : 'data-go-menu'}>${p.image ? `<img src="${S.esc(p.image)}" alt="" loading="lazy">` : ''}<div class="shade"></div>
        <div class="txt"><span class="off">${off}</span><h3>${S.esc(p.title)}</h3><p>${S.esc(p.description)}</p></div></button>`;
    }).join('');
    document.querySelectorAll('[data-go-menu]').forEach(b => b.onclick = () => location.href = '/cardapio.html');
  }

  // destaques: produtos marcados como "mais pedidos" no painel
  const featured = all.filter(p => p.featured).slice(0, 8);
  const list = featured.length ? featured : all.slice(0, 8);
  $('#featured').innerHTML = list.length ? list.map(S.cardHtml).join('')
    : `<div class="empty-state" style="grid-column:1/-1"><h2>Cardápio em breve</h2><p>Estamos preparando nosso cardápio online. Enquanto isso, faça seu pedido pelo WhatsApp.</p>
       <a class="btn btn-wa" href="${S.waLink('Olá! Gostaria de fazer um pedido.')}" target="_blank" rel="noopener">${S.ICONS.wa} Pedir pelo WhatsApp</a></div>`;
})();
