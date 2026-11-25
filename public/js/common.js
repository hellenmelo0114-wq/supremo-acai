// Funções compartilhadas da loja: identidade visual, carrinho, modal do produto, WhatsApp.
(function () {
  const S = (window.Supremo = {});
  const $ = (sel, el = document) => el.querySelector(sel);
  S.$ = $;
  S.money = (c) => 'R$ ' + ((c || 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  S.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  S.api = async (url, opts = {}) => {
    const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente.');
    return data;
  };

  const ICONS = {
    wa: '<svg viewBox="0 0 24 24" fill="currentColor" class="icon"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    track: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>'
  };
  S.ICONS = ICONS;

  // ---------------- Configuração da loja / identidade visual ----------------
  S.config = null;
  S.ready = (async () => {
    try { S.config = await S.api('/api/public/config'); } catch { S.config = {}; }
    applyBrand(S.config);
    renderChrome();
    return S.config;
  })();

  function applyBrand(c) {
    const colors = c.brand_colors || {};
    const map = { primary: '--brand', dark: '--brand-2', accent: '--accent', accent_text: '--accent-ink', background: '--cream' };
    for (const [k, v] of Object.entries(map)) if (colors[k]) document.documentElement.style.setProperty(v, colors[k]);
    if (colors.primary) { const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = colors.dark || colors.primary; }
    if (c.logo) {
      let l = document.querySelector('link[rel="icon"]');
      if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
      l.href = c.logo;
    }
  }

  S.logoHtml = (cls = '') => {
    const c = S.config || {};
    return c.logo
      ? `<img src="${S.esc(c.logo)}" alt="${S.esc(c.store_name || 'Supremo Açaí e Petiscaria')}" class="${cls}">`
      : `<span class="wordmark">SUPREMO<small>AÇAÍ E PETISCARIA</small></span>`;
  };
  S.waLink = (text) => `https://wa.me/${(S.config && S.config.whatsapp) || '5571992713438'}${text ? '?text=' + encodeURIComponent(text) : ''}`;

  function renderChrome() {
    const c = S.config || {};
    const page = document.body.dataset.page;
    const top = $('#top');
    if (top) {
      top.className = 'topbar';
      top.innerHTML = `<div class="container">
        <a class="logo" href="/" aria-label="Página inicial">${S.logoHtml()}</a>
        <span class="store-status ${c.store_open === false ? 'closed' : ''}">${c.store_open === false ? 'Fechado · abre ' + (c.open_time ? c.open_time.replace(':00', 'h') : '') : 'Aberto para pedidos'}</span>
        <nav class="nav" aria-label="Principal">
          <a href="/" class="${page === 'home' ? 'active' : ''}">Início</a>
          <a href="/cardapio.html" class="${page === 'menu' ? 'active' : ''}">Cardápio</a>
          <a href="/pedido.html" class="${page === 'track' ? 'active' : ''}">Meu pedido</a>
          <a href="${S.waLink('Olá! Vim pelo site da Supremo.')}" target="_blank" rel="noopener">WhatsApp</a>
        </nav>
        <button class="cart-btn" data-open-cart aria-label="Abrir carrinho">${ICONS.cart}<span class="label">Carrinho</span><span class="badge" data-cart-count>0</span></button>
      </div>`;
    }
    const foot = $('#foot');
    if (foot) {
      foot.className = 'footer';
      foot.innerHTML = `<div class="container">
        <div><a class="logo" href="/">${S.logoHtml()}</a>
          <p style="margin-top:14px">${S.esc(c.slogan || 'O MELHOR AÇAÍ E PETISCOS DA REGIÃO!')}</p></div>
        <div><h4>Atendimento</h4><p>${S.esc(c.service_info || 'Delivery e atendimento presencial')}</p>
          ${c.opening_hours ? `<p>${S.esc(c.opening_hours)}</p>` : ''}
          <p><a href="${S.waLink()}" target="_blank" rel="noopener">WhatsApp: ${S.esc(c.whatsapp_display || '(71) 99271-3438')}</a></p></div>
        <div><h4>Endereço</h4><p>${S.esc(c.address || 'Rua Oceano Atlântico, Nº 04, Madre de Deus – BA')}</p>
          <p><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address || 'Rua Oceano Atlântico 04 Madre de Deus BA')}" target="_blank" rel="noopener">Ver no mapa →</a></p></div>
        <div class="copy"><span>© ${new Date().getFullYear()} ${S.esc(c.store_name || 'SUPREMO AÇAÍ E PETISCARIA')}</span><a href="/admin/">Área restrita</a></div>
      </div>`;
    }
    // barra inferior (celular) + botão do WhatsApp
    const bn = document.createElement('nav');
    bn.className = 'bottom-nav'; bn.setAttribute('aria-label', 'Navegação');
    bn.innerHTML = `<a href="/" class="${page === 'home' ? 'active' : ''}">${ICONS.home}Início</a>
      <a href="/cardapio.html" class="${page === 'menu' ? 'active' : ''}">${ICONS.menu}Cardápio</a>
      <button data-open-cart>${ICONS.bag}<span class="badge" data-cart-count hidden>0</span>Carrinho</button>
      <a href="/pedido.html" class="${page === 'track' ? 'active' : ''}">${ICONS.track}Pedido</a>`;
    document.body.appendChild(bn);
    if (page !== 'checkout') {
      const wa = document.createElement('a');
      wa.className = 'wa-float'; wa.href = S.waLink('Olá! Vim pelo site da Supremo.'); wa.target = '_blank'; wa.rel = 'noopener';
      wa.setAttribute('aria-label', 'Falar no WhatsApp'); wa.innerHTML = ICONS.wa;
      document.body.appendChild(wa);
    }
    buildCartDrawer();
    buildProductModal();
    updateCartBadges();
    document.addEventListener('click', (e) => { if (e.target.closest('[data-open-cart]')) { e.preventDefault(); S.openCart(); } });
  }

  // ---------------- Toast ----------------
  let toastEl, toastT;
  S.toast = (msg) => {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
  };

  // ---------------- Carrinho (salvo no navegador) ----------------
  const KEY = 'supremo_cart_v1';
  S.cart = {
    items() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
    save(items) { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* modo privado */ } updateCartBadges(); renderCart(); },
    add(item) {
      const items = this.items();
      const sig = JSON.stringify([item.product_id, item.size_id, item.addons.map(a => a.id).sort(), item.notes]);
      const ex = items.find(i => i.sig === sig);
      if (ex) ex.quantity = Math.min(50, ex.quantity + item.quantity);
      else items.push({ ...item, sig, key: Date.now() + Math.random().toString(36).slice(2) });
      this.save(items);
    },
    setQty(key, q) { const items = this.items(); const i = items.find(x => x.key === key); if (!i) return; i.quantity = Math.max(1, Math.min(50, q)); this.save(items); },
    remove(key) { this.save(this.items().filter(i => i.key !== key)); },
    clear() { this.save([]); },
    count() { return this.items().reduce((s, i) => s + i.quantity, 0); },
    subtotal() { return this.items().reduce((s, i) => s + i.unit_price * i.quantity, 0); }
  };
  function updateCartBadges() {
    const n = S.cart.count();
    document.querySelectorAll('[data-cart-count]').forEach(b => { b.textContent = n; if (b.closest('.bottom-nav')) b.hidden = n === 0; });
  }

  function buildCartDrawer() {
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'cartOverlay';
    const d = document.createElement('aside'); d.className = 'sheet drawer'; d.id = 'cartDrawer'; d.setAttribute('aria-label', 'Carrinho'); d.setAttribute('role', 'dialog');
    d.innerHTML = `<div class="sheet-head"><h3>Seu pedido</h3><button class="x" data-close aria-label="Fechar">×</button></div>
      <div class="sheet-body" id="cartBody"></div><div class="sheet-foot" id="cartFoot"></div>`;
    document.body.append(ov, d);
    ov.addEventListener('click', S.closeCart);
    d.querySelector('[data-close]').addEventListener('click', S.closeCart);
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const key = b.dataset.key; const item = S.cart.items().find(i => i.key === key);
      if (b.dataset.act === 'inc') S.cart.setQty(key, item.quantity + 1);
      if (b.dataset.act === 'dec') item.quantity > 1 ? S.cart.setQty(key, item.quantity - 1) : S.cart.remove(key);
      if (b.dataset.act === 'rm') S.cart.remove(key);
    });
    renderCart();
  }
  function renderCart() {
    const body = $('#cartBody'); const foot = $('#cartFoot'); if (!body) return;
    const items = S.cart.items();
    if (!items.length) {
      body.innerHTML = `<div class="empty-state" style="padding:50px 10px"><h3>Seu carrinho está vazio</h3><p>Escolha seus favoritos no cardápio.</p></div>`;
      foot.innerHTML = `<a class="btn btn-brand btn-block" href="/cardapio.html">Ver cardápio</a>`;
      return;
    }
    body.innerHTML = items.map(i => `<div class="cart-item">
      <h4>${S.esc(i.name)}${i.size_name ? ` <small style="color:var(--muted);font-weight:600">· ${S.esc(i.size_name)}</small>` : ''}</h4>
      <strong>${S.money(i.unit_price * i.quantity)}</strong>
      ${i.addons.length || i.notes ? `<div class="meta">${i.addons.map(a => S.esc(a.name)).join(', ')}${i.notes ? `<br><em>Obs.: ${S.esc(i.notes)}</em>` : ''}</div>` : ''}
      <div class="row"><div class="qty sm"><button data-act="dec" data-key="${i.key}" aria-label="Diminuir">−</button><span>${i.quantity}</span><button data-act="inc" data-key="${i.key}" aria-label="Aumentar">+</button></div>
      <button class="link-btn" data-act="rm" data-key="${i.key}">Remover</button></div></div>`).join('');
    const c = S.config || {};
    const sub = S.cart.subtotal();
    foot.innerHTML = `<div class="totals"><div><span>Subtotal</span><span>${S.money(sub)}</span></div>
      <div><span>Taxa de entrega</span><span>${c.delivery_enabled === false ? '—' : S.money(c.delivery_fee) + ' <small>(delivery)</small>'}</span></div>
      <div class="grand"><span>Total com entrega</span><span>${S.money(sub + (c.delivery_enabled === false ? 0 : c.delivery_fee || 0))}</span></div></div>
      ${c.store_open === false ? `<div class="alert">Estamos fechados agora${c.opening_hours ? ' · ' + S.esc(c.opening_hours) : ''}.</div>` : ''}
      <a class="btn btn-accent btn-block btn-lg" href="/checkout.html">Finalizar pedido</a>`;
  }
  S.openCart = () => { renderCart(); $('#cartOverlay').classList.add('on'); $('#cartDrawer').classList.add('on'); };
  S.closeCart = () => { $('#cartOverlay').classList.remove('on'); $('#cartDrawer').classList.remove('on'); };

  // ---------------- Modal de personalização do produto ----------------
  let modalState = null;
  function buildProductModal() {
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'pmOverlay';
    const m = document.createElement('div'); m.className = 'sheet modal'; m.id = 'pm'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    document.body.append(ov, m);
    ov.addEventListener('click', closeProduct);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeProduct(); S.closeCart(); } });
  }
  function closeProduct() { $('#pmOverlay')?.classList.remove('on'); $('#pm')?.classList.remove('on'); }
  S.productPrice = (p) => {
    if (p.sizes && p.sizes.length) {
      const min = Math.min(...p.sizes.map(s => s.promo_price)); const minOrig = Math.min(...p.sizes.map(s => s.price));
      return { from: true, price: min, orig: minOrig };
    }
    return { from: false, price: p.promo_price, orig: p.price };
  };
  S.priceHtml = (p) => {
    const pp = S.productPrice(p);
    return `<span class="price">${pp.from ? '<small>a partir de</small>' : ''}${pp.orig > pp.price ? `<s>${S.money(pp.orig)}</s>` : ''}${S.money(pp.price)}</span>`;
  };
  S.cardHtml = (p) => `<button class="p-card" data-product="${p.id}">
    <div class="ph">${p.image ? `<img src="${S.esc(p.image)}" alt="${S.esc(p.name)}" loading="lazy" decoding="async">` : `<div class="noimg">${S.esc(p.name.slice(0, 1))}</div>`}
      ${p.promo ? '<span class="tag">Promoção</span>' : p.featured ? '<span class="tag">Mais pedido</span>' : ''}</div>
    <div class="body"><h3>${S.esc(p.name)}</h3><div class="desc">${S.esc(p.description)}</div>
      <div class="foot">${S.priceHtml(p)}<span class="add-round" aria-hidden="true">+</span></div></div></button>`;

  S.openProduct = (p) => {
    modalState = { p, size: p.sizes.length === 1 ? p.sizes[0].id : null, addons: new Set(), qty: 1 };
    const m = $('#pm');
    m.innerHTML = `<div class="sheet-head"><h3>${S.esc(p.name)}</h3><button class="x" aria-label="Fechar">×</button></div>
      <div class="sheet-body">
        ${p.image ? `<div class="pm-img"><img src="${S.esc(p.image)}" alt="${S.esc(p.name)}"></div>` : ''}
        ${p.description ? `<p style="color:var(--muted);margin-top:0">${S.esc(p.description)}</p>` : ''}
        ${p.sizes.length ? `<div class="opt-group"><h4>Escolha o tamanho <span class="req">Obrigatório</span></h4>
          ${p.sizes.map(s => `<label class="opt"><input type="radio" name="size" value="${s.id}" ${modalState.size === s.id ? 'checked' : ''}><span>${S.esc(s.name)}</span>
          <b>${s.promo_price < s.price ? `<s style="color:var(--muted);font-weight:500">${S.money(s.price)}</s> ` : ''}${S.money(s.promo_price)}</b></label>`).join('')}</div>` : ''}
        ${p.addon_groups.filter(g => g.addons.length).map(g => `<div class="opt-group" data-group="${g.id}" data-min="${g.min_select}" data-max="${g.max_select}">
          <h4><span>${S.esc(g.name)}${g.min_select ? '<span class="req">Obrigatório</span>' : ''}</span>
          <small>${g.max_select ? `até ${g.max_select}` : 'opcional'}${g.min_select ? ` · mín. ${g.min_select}` : ''}</small></h4>
          ${g.addons.map(a => `<label class="opt"><input type="${g.max_select === 1 ? 'radio' : 'checkbox'}" name="grp${g.id}" value="${a.id}" data-price="${a.price}" data-name="${S.esc(a.name)}"><span>${S.esc(a.name)}</span><b>${a.price ? '+ ' + S.money(a.price) : 'Grátis'}</b></label>`).join('')}
        </div>`).join('')}
        <label class="field"><span>Observações</span><textarea rows="2" maxlength="300" id="pmNotes" placeholder="Ex.: sem granola, caprichar na calda…"></textarea></label>
        <div class="alert" id="pmErr" hidden></div>
      </div>
      <div class="sheet-foot"><div class="foot-row">
        <div class="qty"><button data-q="-1" aria-label="Diminuir">−</button><span id="pmQty">1</span><button data-q="1" aria-label="Aumentar">+</button></div>
        <button class="btn btn-accent btn-lg" id="pmAdd"><span>ADICIONAR AO CARRINHO</span><span id="pmTotal"></span></button>
      </div></div>`;
    m.querySelector('.x').onclick = closeProduct;
    m.querySelectorAll('input[name=size]').forEach(r => r.onchange = () => { modalState.size = Number(r.value); updateTotal(); });
    m.querySelectorAll('[data-group] input').forEach(cb => cb.onchange = () => {
      const g = cb.closest('[data-group]'); const max = Number(g.dataset.max);
      const checked = g.querySelectorAll('input:checked');
      if (max && checked.length > max) { cb.checked = false; S.toast(`Você pode escolher até ${max} opção(ões) neste grupo.`); }
      modalState.addons = new Set([...m.querySelectorAll('[data-group] input:checked')].map(i => Number(i.value)));
      const er = $('#pmErr'); if (er && er.className === 'alert') er.hidden = true;
      updateTotal();
    });
    m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { modalState.qty = Math.max(1, Math.min(50, modalState.qty + Number(b.dataset.q))); $('#pmQty').textContent = modalState.qty; updateTotal(); });
    $('#pmAdd').onclick = addFromModal;
    if (S.config && S.config.store_open === false) { $('#pmErr').hidden = false; $('#pmErr').textContent = 'A loja está fechada no momento, mas você pode montar seu pedido.'; $('#pmErr').className = 'alert info'; }
    updateTotal();
    $('#pmOverlay').classList.add('on'); m.classList.add('on');
  };
  function unitPrice() {
    const { p } = modalState; let base = p.promo_price;
    if (p.sizes.length) { const s = p.sizes.find(x => x.id === modalState.size); base = s ? s.promo_price : 0; }
    let add = 0;
    document.querySelectorAll('#pm [data-group] input:checked').forEach(i => add += Number(i.dataset.price));
    return base + add;
  }
  function updateTotal() { $('#pmTotal').textContent = S.money(unitPrice() * modalState.qty); }
  function addFromModal() {
    const { p } = modalState; const err = $('#pmErr');
    err.className = 'alert'; err.hidden = true;
    if (p.sizes.length && !modalState.size) { err.hidden = false; err.textContent = 'Escolha o tamanho.'; return; }
    for (const g of document.querySelectorAll('#pm [data-group]')) {
      const n = g.querySelectorAll('input:checked').length; const min = Number(g.dataset.min);
      if (min && n < min) { err.hidden = false; err.textContent = `Escolha pelo menos ${min} em "${g.querySelector('h4 span').firstChild.textContent}".`; g.scrollIntoView({ behavior: 'smooth' }); return; }
    }
    const size = p.sizes.find(s => s.id === modalState.size);
    S.cart.add({
      product_id: p.id, size_id: size ? size.id : null, name: p.name, size_name: size ? size.name : null, image: p.image,
      unit_price: unitPrice(), quantity: modalState.qty,
      addons: [...document.querySelectorAll('#pm [data-group] input:checked')].map(i => ({ id: Number(i.value), name: i.dataset.name, price: Number(i.dataset.price) })),
      notes: $('#pmNotes').value.trim()
    });
    closeProduct();
    S.toast('Adicionado ao carrinho ✓');
  }

  // abrir produto a partir de cards em qualquer página
  S.productIndex = new Map();
  S.indexProducts = (menu) => {
    for (const c of menu.categories) for (const p of c.products) S.productIndex.set(p.id, p);
    for (const p of menu.uncategorized || []) S.productIndex.set(p.id, p);
  };
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-product]');
    if (card) { const p = S.productIndex.get(Number(card.dataset.product)); if (p) S.openProduct(p); }
  });

  // ---------------- Resumo do pedido para WhatsApp ----------------
  const PAY = { pix: 'PIX', cash: 'Dinheiro', credit: 'Cartão de crédito', debit: 'Cartão de débito' };
  S.PAY = PAY;
  S.orderWhatsappText = (o) => {
    const lines = [`*Pedido #${o.number} — ${S.config?.store_name || 'Supremo Açaí'}*`, `Código: ${o.code}`, ''];
    for (const i of o.items) {
      lines.push(`• ${i.quantity}x ${i.product_name}${i.size_name ? ` (${i.size_name})` : ''} — ${S.money(i.total)}`);
      if (i.addons.length) lines.push(`   + ${i.addons.join(', ')}`);
      if (i.notes) lines.push(`   Obs.: ${i.notes}`);
    }
    lines.push('', `Subtotal: ${S.money(o.subtotal)}`);
    if (o.mode === 'delivery') lines.push(`Taxa de entrega: ${S.money(o.delivery_fee)}`);
    lines.push(`*Total: ${S.money(o.total)}*`, '');
    lines.push(`Cliente: ${o.customer_name}`);
    lines.push(o.mode === 'delivery' ? `Entrega: ${o.address}${o.address_ref ? ` (Ref.: ${o.address_ref})` : ''}` : 'Retirada na loja');
    lines.push(`Pagamento: ${PAY[o.payment_method]}${o.change_for ? ` (troco para ${S.money(o.change_for)})` : ''}`);
    if (o.notes) lines.push(`Obs.: ${o.notes}`);
    lines.push('', `Acompanhar: ${location.origin}/pedido.html?c=${o.code}`);
    return lines.join('\n');
  };
})();
