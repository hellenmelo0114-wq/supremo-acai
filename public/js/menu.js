(async function () {
  const S = window.Supremo; const $ = S.$;
  await S.ready;
  let menu;
  try { menu = await S.api('/api/public/menu'); } catch { menu = { categories: [], uncategorized: [] }; }
  S.indexProducts(menu);
  const sections = menu.categories.filter(c => c.products.length);
  if (menu.uncategorized.length) sections.push({ id: 'outros', name: 'Outros', products: menu.uncategorized });

  function render(filter = '') {
    const f = filter.trim().toLowerCase();
    const vis = sections.map(s => ({ ...s, products: s.products.filter(p => !f || (p.name + ' ' + p.description).toLowerCase().includes(f)) })).filter(s => s.products.length);
    $('#tabs').innerHTML = vis.map((s, i) => `<a href="#cat-${s.id}" class="${i === 0 ? 'active' : ''}">${S.esc(s.name)}</a>`).join('');
    if (!sections.length) {
      $('#menu').innerHTML = `<div class="empty-state"><h2>Cardápio em breve</h2><p>Nosso cardápio online está sendo cadastrado. Faça seu pedido pelo WhatsApp enquanto isso.</p>
        <a class="btn btn-wa" href="${S.waLink('Olá! Gostaria de fazer um pedido.')}" target="_blank" rel="noopener">${S.ICONS.wa} Pedir pelo WhatsApp</a></div>`;
      return;
    }
    $('#menu').innerHTML = vis.length ? vis.map(s => `<section class="cat-section" id="cat-${s.id}"><h2>${S.esc(s.name)}</h2>
      <div class="grid">${s.products.map(S.cardHtml).join('')}</div></section>`).join('')
      : `<div class="empty-state"><h3>Nada encontrado para "${S.esc(filter)}"</h3></div>`;
    observe();
  }

  // destaca a categoria visível
  let io;
  function observe() {
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        document.querySelectorAll('#tabs a').forEach(a => {
          const on = a.getAttribute('href') === '#' + e.target.id; a.classList.toggle('active', on);
          if (on) a.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        });
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('.cat-section').forEach(s => io.observe(s));
  }
  let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => render(e.target.value), 150); });
  render();
  // abre produto via link direto (?p=ID)
  const pid = Number(new URLSearchParams(location.search).get('p'));
  if (pid && S.productIndex.get(pid)) S.openProduct(S.productIndex.get(pid));
})();
