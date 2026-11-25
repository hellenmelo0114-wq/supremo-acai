// Painel gerencial — núcleo, Dashboard, Pedidos e Produtos.
(function () {
  const A = (window.Admin = { sections: {} });
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  A.$ = $; A.$$ = $$;
  const esc = A.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const money = A.money = (c) => 'R$ ' + ((c || 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  A.toReais = (c) => ((c || 0) / 100).toFixed(2).replace('.', ',');
  A.br = (d) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}${d.length > 10 ? ' ' + d.slice(11, 16) : ''}` : '';
  A.qty = (q) => Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  A.today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  A.monthStart = () => A.today().slice(0, 8) + '01';
  A.STATUS = { received: 'Recebido', confirmed: 'Confirmado', preparing: 'Em preparação', out_for_delivery: 'Saiu p/ entrega', delivered: 'Entregue', rejected: 'Recusado', cancelled: 'Cancelado' };
  A.STATUS_BADGE = { received: 'b-danger', confirmed: 'b-info', preparing: 'b-warn', out_for_delivery: 'b-info', delivered: 'b-ok', rejected: 'b-gray', cancelled: 'b-gray' };
  A.PAY = { pix: 'PIX', cash: 'Dinheiro', credit: 'Crédito', debit: 'Débito' };
  A.MODE = { delivery: 'Delivery', pickup: 'Retirada', local: 'Balcão' };

  A.api = async (url, opts = {}) => {
    const r = await fetch('/api' + url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'supremo', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
    if (r.status === 401 && !url.startsWith('/auth')) { location.reload(); throw new Error('Sessão expirada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao processar.');
    return d;
  };
  A.toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); };
  A.can = (p) => A.perms.includes(p);

  // ---------- Modal genérico ----------
  A.modal = ({ title, body, submit = 'Salvar', wide = false, onSubmit, onOpen, extraButtons = '' }) => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate><header><h2>${esc(title)}</h2><button type="button" class="x" aria-label="Fechar">×</button></header>
      <div class="body">${body}<div class="alert danger" data-err hidden></div></div>
      <footer>${extraButtons}<button type="button" class="btn" data-cancel>Cancelar</button>${onSubmit ? `<button class="btn primary" type="submit">${esc(submit)}</button>` : ''}</footer></form>`;
    document.body.appendChild(bg);
    const form = bg.querySelector('form');
    const close = () => bg.remove();
    bg.querySelector('.x').onclick = close; bg.querySelector('[data-cancel]').onclick = close;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = form.querySelector('[data-err]'); err.hidden = true;
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { if ((await onSubmit(form)) !== false) close(); }
      catch (ex) { err.hidden = false; err.textContent = ex.message; }
      finally { btn.disabled = false; }
    };
    onOpen && onOpen(form, close);
    setTimeout(() => form.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 30);
    return { form, close };
  };
  A.confirm = (title, text, onYes, { input = null, danger = false } = {}) => A.modal({
    title, submit: 'Confirmar',
    body: `<p>${text}</p>${input ? `<label class="field"><span>${esc(input)}</span><textarea name="reason" rows="2" required></textarea></label>` : ''}`,
    onSubmit: (f) => onYes(f.elements.reason ? f.elements.reason.value.trim() : null, f),
    onOpen: (f) => { if (danger) f.querySelector('[type=submit]').className = 'btn danger'; }
  });
  A.formData = (form) => {
    const o = {};
    for (const el of form.elements) {
      if (!el.name || el.dataset.skip !== undefined) continue;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value;
    }
    return o;
  };
  A.upload = async (file) => {
    const fd = new FormData(); fd.append('image', file);
    const r = await fetch('/api/admin/upload', { method: 'POST', body: fd, headers: { 'X-Requested-With': 'supremo' } });
    const d = await r.json(); if (!r.ok) throw new Error(d.error); return d.url;
  };
  // campo de imagem com pré-visualização e envio
  A.imageField = (name, value, label = 'Foto') => `<div class="field"><span>${label}</span><div class="img-pick">
    <img data-prev="${name}" src="${esc(value || '')}" alt="" ${value ? '' : 'style="visibility:hidden"'}>
    <div><input type="hidden" name="${name}" value="${esc(value || '')}"><input type="file" accept="image/jpeg,image/png,image/webp" data-up="${name}" data-skip>
    <div class="hint">JPG, PNG ou WEBP até 8 MB. Use as fotos originais dos produtos.</div>
    ${value ? `<button type="button" class="btn sm" data-clear="${name}">Remover foto</button>` : ''}</div></div></div>`;
  A.bindImages = (form) => {
    $$('[data-up]', form).forEach(inp => inp.onchange = async () => {
      if (!inp.files[0]) return;
      try {
        const url = await A.upload(inp.files[0]);
        form.elements[inp.dataset.up].value = url;
        const pv = form.querySelector(`[data-prev="${inp.dataset.up}"]`); pv.src = url; pv.style.visibility = 'visible';
      } catch (e) { A.toast(e.message); }
    });
    $$('[data-clear]', form).forEach(b => b.onclick = () => { form.elements[b.dataset.clear].value = ''; form.querySelector(`[data-prev="${b.dataset.clear}"]`).style.visibility = 'hidden'; });
  };
  A.table = (cols, rows, empty = 'Nenhum registro.') => rows.length
    ? `<div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<div class="empty">${esc(empty)}</div>`;
  A.periodFilter = (state, onChange) => {
    const html = `<div class="filters" data-period>
      <div class="seg">${[['today', 'Hoje'], ['week', '7 dias'], ['month', 'Mês'], ['custom', 'Período']].map(([k, l]) => `<button type="button" data-p="${k}" class="${state.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span data-custom ${state.period === 'custom' ? '' : 'hidden'}><input type="date" data-from value="${state.from || A.monthStart()}"> até <input type="date" data-to value="${state.to || A.today()}"> <button type="button" class="btn sm primary" data-apply>Aplicar</button></span></div>`;
    const bind = (root) => {
      const box = root.querySelector('[data-period]');
      $$('[data-p]', box).forEach(b => b.onclick = () => {
        state.period = b.dataset.p;
        if (state.period === 'custom') { $$('[data-p]', box).forEach(x => x.classList.toggle('on', x === b)); box.querySelector('[data-custom]').hidden = false; return; }
        onChange();
      });
      box.querySelector('[data-apply]').onclick = () => { state.from = box.querySelector('[data-from]').value; state.to = box.querySelector('[data-to]').value; onChange(); };
    };
    return { html, bind };
  };

  // ---------- Inicialização ----------
  const SECTIONS = [
    ['dashboard', 'Dashboard', '📊', 'dashboard'], ['orders', 'Pedidos', '🧾', 'orders'], ['products', 'Produtos', '🍧', 'products'],
    ['stock', 'Estoque', '📦', 'stock'], ['movements', 'Entradas e saídas', '🔄', 'movements'], ['recipes', 'Fichas técnicas', '📋', 'recipes'],
    ['finance', 'Financeiro', '💰', 'finance'], ['cash', 'Fluxo de caixa', '🏧', 'cash'], ['suppliers', 'Fornecedores', '🚚', 'suppliers'],
    ['employees', 'Funcionários', '👥', 'employees'], ['reports', 'Relatórios', '📈', ['reports.operational', 'reports.financial']], ['settings', 'Configurações', '⚙️', 'settings']
  ];
  async function boot() {
    const root = $('#root');
    const setup = await A.api('/auth/setup-needed');
    if (setup.needed) return renderSetup(root);
    let me;
    try { me = await A.api('/auth/me'); } catch { return renderLogin(root); }
    A.user = me.user; A.perms = me.permissions;
    try { A.config = await (await fetch('/api/public/config')).json(); } catch { A.config = {}; }
    const colors = A.config.brand_colors || {};
    if (colors.primary) document.documentElement.style.setProperty('--brand', colors.primary);
    if (colors.dark) document.documentElement.style.setProperty('--brand-2', colors.dark);
    if (colors.accent) document.documentElement.style.setProperty('--accent', colors.accent);
    const visible = SECTIONS.filter(([, , , p]) => [].concat(p).some(A.can));
    root.innerHTML = `<div class="mobile-bar"><button aria-label="Menu" data-menu>☰</button><strong>SUPREMO · Painel</strong></div>
      <div class="app"><aside class="side" id="side"><div class="brand">${A.config.logo ? `<img src="${esc(A.config.logo)}" alt="">` : ''}<div>SUPREMO<small>PAINEL GERENCIAL</small></div></div>
      <nav>${visible.map(([id, label, ic]) => `<a href="#${id}" data-sec="${id}"><span>${ic}</span>${label}${id === 'orders' ? '<span class="n" id="pendingN" hidden>0</span>' : ''}</a>`).join('')}</nav>
      <div class="me"><strong>${esc(A.user.name)}</strong><br><span style="opacity:.7">${esc(A.user.role_label)}</span><br>
      <a href="/" target="_blank" style="color:#fff;opacity:.75">Ver loja ↗</a> · <button data-logout>Sair</button></div></aside>
      <main class="main" id="main"></main></div>`;
    $('[data-menu]').onclick = () => $('#side').classList.toggle('on');
    $('[data-logout]').onclick = async () => { await A.api('/auth/logout', { method: 'POST' }); location.reload(); };
    window.addEventListener('hashchange', route);
    route();
    if (A.can('orders')) startLive();
  }
  A.charts = [];
  async function route() {
    const visible = SECTIONS.filter(([, , , p]) => [].concat(p).some(A.can)).map(s => s[0]);
    let id = location.hash.slice(1) || visible[0];
    if (!visible.includes(id)) id = visible[0];
    $$('[data-sec]').forEach(a => a.classList.toggle('active', a.dataset.sec === id));
    $('#side').classList.remove('on');
    A.charts.forEach(c => c.destroy()); A.charts = [];
    A.current = id;
    const main = $('#main');
    main.onclick = null; main.oninput = null;
    main.innerHTML = '<div class="empty">Carregando…</div>';
    try { await A.sections[id](main); } catch (e) { main.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
  }
  A.refresh = () => A.sections[A.current]($('#main'));

  function renderSetup(root) {
    root.innerHTML = `<div class="login"><form class="card"><h1>Configuração inicial</h1>
      <p class="hint">Crie o acesso da proprietária. Este passo só aparece uma vez.</p>
      <label class="field"><span>Nome completo</span><input name="name" required></label>
      <label class="field"><span>Usuário (para login)</span><input name="username" autocomplete="username" required></label>
      <label class="field"><span>Senha (mín. 8 caracteres, com letras e números)</span><input name="password" type="password" autocomplete="new-password" required></label>
      <div class="alert danger" hidden data-err></div><button class="btn primary" style="width:100%">Criar acesso</button></form></div>`;
    const f = $('form', root);
    f.onsubmit = async (e) => { e.preventDefault(); try { await A.api('/auth/setup', { method: 'POST', body: A.formData(f) }); location.reload(); } catch (ex) { const er = $('[data-err]', f); er.hidden = false; er.textContent = ex.message; } };
  }
  function renderLogin(root) {
    root.innerHTML = `<div class="login"><form class="card"><h1>Painel Supremo</h1><p class="hint">Área restrita à proprietária e funcionários autorizados.</p>
      <label class="field"><span>Usuário</span><input name="username" autocomplete="username" required></label>
      <label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required></label>
      <div class="alert danger" hidden data-err></div><button class="btn primary" style="width:100%">Entrar</button>
      <p class="hint" style="margin-top:14px"><a href="/">← Voltar para a loja</a></p></form></div>`;
    const f = $('form', root);
    f.onsubmit = async (e) => { e.preventDefault(); try { await A.api('/auth/login', { method: 'POST', body: A.formData(f) }); location.reload(); } catch (ex) { const er = $('[data-err]', f); er.hidden = false; er.textContent = ex.message; } };
  }

  // ---------- Pedidos em tempo real + aviso sonoro ----------
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, .25, .5].forEach(t => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(.2, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + .2); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .22); });
    } catch { /* sem áudio */ }
  }
  async function updatePending() {
    try { const list = await A.api('/admin/orders?status=received&limit=50'); const n = $('#pendingN'); n.hidden = !list.length; n.textContent = list.length; document.title = (list.length ? `(${list.length}) ` : '') + 'Painel Supremo'; } catch { /* ignore */ }
  }
  // verifica pedidos novos/atualizados a cada 10 s
  let lastSig = null; let lastMaxId = null;
  async function poll() {
    try {
      const list = await A.api('/admin/orders?status=open&limit=100');
      const maxId = list.reduce((m, o) => Math.max(m, o.id), 0);
      const sig = list.map(o => o.id + ':' + o.status + ':' + o.payment_status).join(',');
      if (lastMaxId !== null && maxId > lastMaxId) { beep(); A.toast('🔔 Novo pedido recebido!'); if (window.Notification?.permission === 'granted') new Notification('Novo pedido na Supremo!'); }
      if (lastSig !== null && sig !== lastSig && (A.current === 'orders' || A.current === 'dashboard')) A.refreshSoon();
      lastSig = sig; lastMaxId = Math.max(maxId, lastMaxId || 0);
      updatePending();
    } catch { /* sem conexão: tenta de novo */ }
  }
  function startLive() {
    poll();
    setInterval(poll, 10000);
    if (window.Notification && Notification.permission === 'default') document.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }
  let rt; A.refreshSoon = () => { clearTimeout(rt); rt = setTimeout(() => { if (!document.querySelector('.modal-bg')) A.refresh(); }, 400); };

  // ======================================================================
  // DASHBOARD
  // ======================================================================
  const dashState = { period: 'today' };
  A.sections.dashboard = async (main) => {
    const q = new URLSearchParams({ period: dashState.period, from: dashState.from || '', to: dashState.to || '' });
    const d = await A.api('/admin/dashboard?' + q);
    const k = d.kpis;
    const pf = A.periodFilter(dashState, () => A.refresh());
    const cmp = d.charts.comparison; const diff = cmp.previous.revenue ? ((cmp.current.revenue - cmp.previous.revenue) / cmp.previous.revenue * 100) : null;
    const top = d.top[0];
    main.innerHTML = `<div class="topline"><h1>Dashboard</h1><span class="hint">${A.br(d.from)}${d.from !== d.to ? ' a ' + A.br(d.to) : ''}</span></div>
      ${pf.html}
      <h2>Indicadores essenciais</h2>
      <div class="grid kpis" style="margin-bottom:14px">
        <div class="kpi hero"><div class="l">Faturamento</div><div class="v">${money(k.revenue)}</div><div class="s">${k.orders_completed} pedido(s) concluído(s)</div></div>
        ${d.financial ? `<div class="kpi hero"><div class="l">Lucro estimado</div><div class="v">${money(k.profit_estimate)}</div><div class="s">após CMV e despesas operacionais</div></div>` : ''}
        <div class="kpi hero"><div class="l">Valor em estoque</div><div class="v">${money(k.stock_value)}</div><div class="s">${k.low_stock_count} item(ns) para repor</div></div>
        <div class="kpi hero"><div class="l">Produto campeão</div><div class="v" style="font-size:1.15rem">${top ? esc(top.name) : '—'}</div><div class="s">${top ? `${top.qty} vendido(s) · ${money(top.revenue)}` : 'sem vendas no período'}</div></div>
        ${d.financial ? `<div class="kpi hero"><div class="l">Fluxo de caixa</div><div class="v" id="cashKpi">…</div><div class="s">recebido − pago no período</div></div>` : ''}
      </div>
      <div class="grid kpis" style="margin-bottom:18px">
        <div class="kpi"><div class="l">Faturamento hoje</div><div class="v">${money(k.revenue_today)}</div></div>
        <div class="kpi"><div class="l">Faturamento do mês</div><div class="v">${money(k.revenue_month)}</div></div>
        <div class="kpi"><div class="l">Pedidos recebidos</div><div class="v">${k.orders_received}</div><div class="s">${k.orders_cancelled} cancelado(s)/recusado(s)</div></div>
        <div class="kpi"><div class="l">Em andamento</div><div class="v">${k.orders_in_progress}</div><div class="s">${k.orders_pending} aguardando confirmação</div></div>
        <div class="kpi"><div class="l">Concluídos</div><div class="v">${k.orders_completed}</div></div>
        <div class="kpi"><div class="l">Ticket médio</div><div class="v">${money(k.avg_ticket)}</div></div>
        ${d.financial ? `<div class="kpi"><div class="l">Despesas</div><div class="v">${money(k.expenses_total)}</div><div class="s">operacionais: ${money(k.expenses_operational)}</div></div>
        <div class="kpi"><div class="l">CMV estimado</div><div class="v">${money(k.cmv)}</div><div class="s">${k.recipes_configured ? 'pelas fichas técnicas' : 'cadastre as fichas técnicas'}</div></div>` : ''}
        <div class="kpi"><div class="l">Comparativo</div><div class="v ${diff == null ? '' : diff >= 0 ? 'up' : 'down'}">${diff == null ? '—' : (diff >= 0 ? '▲ ' : '▼ ') + Math.abs(diff).toFixed(1) + '%'}</div><div class="s">vs. ${A.br(cmp.previous.from)}–${A.br(cmp.previous.to)} (${money(cmp.previous.revenue)})</div></div>
      </div>
      ${d.financial && !k.recipes_configured ? '<div class="alert info" style="margin-bottom:14px">O lucro estimado fica mais preciso após cadastrar as fichas técnicas (custo dos ingredientes de cada produto).</div>' : ''}
      <div class="grid g2" style="margin-bottom:14px">
        <div class="card"><h2>Alertas</h2><div class="alerts">${d.alerts.length ? d.alerts.map(a => `<div class="alert ${a.level}">${esc(a.text)}</div>`).join('') : '<div class="alert ok">Nenhum alerta no momento.</div>'}</div></div>
        <div class="card"><h2>Vendas por dia</h2><div class="chart-box"><canvas id="cDaily" aria-label="Faturamento por dia"></canvas></div></div>
      </div>
      <div class="grid g2" style="margin-bottom:14px">
        <div class="card"><h2>Faturamento semanal <span class="hint">(últimas 12 semanas)</span></h2><div class="chart-box"><canvas id="cWeekly"></canvas></div></div>
        <div class="card"><h2>Faturamento mensal ${d.financial ? 'x despesas' : ''} <span class="hint">(12 meses)</span></h2><div class="chart-box"><canvas id="cMonthly"></canvas></div></div>
      </div>
      <div class="grid g2" style="margin-bottom:14px">
        <div class="card"><h2>Vendas por categoria</h2><div class="chart-box"><canvas id="cCat"></canvas></div></div>
        <div class="card"><h2>Formas de pagamento</h2><div class="chart-box"><canvas id="cPay"></canvas></div></div>
      </div>
      <div class="grid g3">
        <div class="card"><h2>Mais vendidos</h2>${A.table([{ t: 'Produto' }, { t: 'Qtd', num: 1 }, { t: 'Valor', num: 1 }], d.top.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.qty}</td><td class="num">${money(r.revenue)}</td></tr>`), 'Sem vendas no período.')}</div>
        <div class="card"><h2>Menos vendidos</h2>${A.table([{ t: 'Produto' }, { t: 'Qtd', num: 1 }, { t: 'Valor', num: 1 }], d.bottom.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.qty}</td><td class="num">${money(r.revenue)}</td></tr>`), 'Sem vendas no período.')}</div>
        <div class="card"><h2>Estoque baixo</h2>${A.table([{ t: 'Item' }, { t: 'Atual', num: 1 }, { t: 'Mínimo', num: 1 }], d.low_stock.map(r => `<tr><td>${esc(r.name)}</td><td class="num ${r.quantity <= 0 ? 'down' : ''}">${A.qty(r.quantity)} ${esc(r.unit)}</td><td class="num">${A.qty(r.min_quantity)}</td></tr>`), 'Nenhum item abaixo do mínimo.')}</div>
      </div>`;
    pf.bind(main);
    if (d.financial) {
      A.api(`/admin/finance?from=${d.from}&to=${d.to}`).then(f => { const el = $('#cashKpi'); if (el) el.textContent = money(f.summary.balance); }).catch(() => { });
    }
    drawCharts(d);
  };

  // Gráficos: uma série = uma cor (sem legenda); duas séries = legenda + cores fixas.
  function chartDefaults() {
    if (!window.Chart) return false;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = '#6e6474';
    Chart.defaults.borderColor = '#efebe3';
    return true;
  }
  const moneyTick = (v) => 'R$ ' + (v / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const moneyTip = { callbacks: { label: (c) => `${c.dataset.label ? c.dataset.label + ': ' : ''}${money(c.raw)}` } };
  const noData = (el, sets) => {
    if (sets.every(d => d.every(v => !v))) { el.parentElement.innerHTML = '<div class="empty">Sem dados no período.</div>'; return true; }
    return false;
  };
  A.bar = (id, labels, datasets, { horizontal = false } = {}) => {
    const el = document.getElementById(id); if (!el || !chartDefaults()) return;
    if (noData(el, datasets.map(d => d.data))) return;
    const colors = ['#257de0', '#f47230'];
    A.charts.push(new Chart(el, {
      type: 'bar',
      data: { labels, datasets: datasets.map((ds, i) => ({ borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, backgroundColor: colors[i], ...ds })) },
      options: {
        indexAxis: horizontal ? 'y' : 'x', maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: datasets.length > 1, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: moneyTip },
        scales: { [horizontal ? 'x' : 'y']: { beginAtZero: true, ticks: { callback: moneyTick }, grid: { color: '#efebe3' } }, [horizontal ? 'y' : 'x']: { grid: { display: false } } }
      }
    }));
  };
  A.line = (id, labels, data, label) => {
    const el = document.getElementById(id); if (!el || !chartDefaults()) return;
    if (noData(el, [data])) return;
    A.charts.push(new Chart(el, {
      type: 'line',
      data: { labels, datasets: [{ label, data, borderColor: '#257de0', backgroundColor: 'rgba(37,125,224,.10)', fill: true, borderWidth: 2, tension: .3, pointRadius: 3, pointHoverRadius: 5 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: moneyTip },
        scales: { y: { beginAtZero: true, ticks: { callback: moneyTick }, grid: { color: '#efebe3' } }, x: { grid: { display: false } } } }
    }));
  };
  function drawCharts(d) {
    const c = d.charts;
    A.bar('cDaily', c.daily.map(x => x.date.slice(8, 10) + '/' + x.date.slice(5, 7)), [{ label: 'Faturamento', data: c.daily.map(x => x.revenue) }]);
    A.line('cWeekly', c.weekly.map(x => x.label), c.weekly.map(x => x.revenue), 'Faturamento');
    A.bar('cMonthly', c.monthly.map(x => x.label), d.financial
      ? [{ label: 'Faturamento', data: c.monthly.map(x => x.revenue) }, { label: 'Despesas', data: c.monthly.map(x => x.expenses) }]
      : [{ label: 'Faturamento', data: c.monthly.map(x => x.revenue) }]);
    A.bar('cCat', c.byCategory.map(x => x.name), [{ label: 'Faturamento', data: c.byCategory.map(x => x.revenue) }], { horizontal: true });
    A.bar('cPay', c.byPayment.map(x => `${x.name} (${x.orders})`), [{ label: 'Faturamento', data: c.byPayment.map(x => x.revenue) }], { horizontal: true });
  }

  // ======================================================================
  // PEDIDOS
  // ======================================================================
  const ordState = { tab: 'open', q: '', from: '', to: '' };
  const NEXT = { received: 'confirmed', confirmed: 'preparing', preparing: 'out_for_delivery', out_for_delivery: 'delivered' };
  const NEXT_LABEL = (o) => ({ received: 'Aceitar pedido', confirmed: 'Iniciar preparo', preparing: o.mode === 'delivery' ? 'Saiu para entrega' : 'Pronto p/ retirada', out_for_delivery: o.mode === 'delivery' ? 'Marcar entregue' : 'Marcar retirado' }[o.status]);
  A.sections.orders = async (main) => {
    const q = new URLSearchParams({ status: ordState.tab === 'all' ? '' : ordState.tab, q: ordState.q, from: ordState.from, to: ordState.to });
    const list = await A.api('/admin/orders?' + q);
    const open = A.config.store_open !== false;
    main.innerHTML = `<div class="topline"><h1>Pedidos</h1>
      <button class="btn ${open ? 'ok' : 'danger'}" data-toggle-store>${open ? '● Loja aberta' : '● Loja fechada'}</button>
      <button class="btn accent" data-counter>+ Venda no balcão</button></div>
      <div class="filters"><div class="seg">${[['open', 'Em andamento'], ['received', 'Aguardando'], ['delivered', 'Concluídos'], ['cancelled', 'Cancelados'], ['all', 'Histórico']].map(([k, l]) => `<button data-tab="${k}" class="${ordState.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input type="search" placeholder="Nome, telefone, nº ou código" value="${esc(ordState.q)}" data-q>
      ${ordState.tab === 'all' || ordState.tab === 'delivered' || ordState.tab === 'cancelled' ? `<input type="date" data-from value="${ordState.from}"> <input type="date" data-to value="${ordState.to}">` : ''}
      <button class="btn sm" data-search>Buscar</button></div>
      ${ordState.tab === 'open' || ordState.tab === 'received' ? `<div class="orders">${list.map(orderCard).join('') || '<div class="empty card">Nenhum pedido em andamento. Novos pedidos aparecem aqui automaticamente com aviso sonoro.</div>'}</div>`
        : `<div class="card">${A.table([{ t: 'Nº' }, { t: 'Data' }, { t: 'Cliente' }, { t: 'Tipo' }, { t: 'Pagamento' }, { t: 'Total', num: 1 }, { t: 'Status' }],
          list.map(o => `<tr data-open="${o.id}" style="cursor:pointer"><td>#${o.id}</td><td>${A.br(o.created_at)}</td><td>${esc(o.customer_name)}</td><td>${A.MODE[o.mode]}</td><td>${A.PAY[o.payment_method]}</td><td class="num">${money(o.total)}</td><td><span class="badge ${A.STATUS_BADGE[o.status]}">${A.STATUS[o.status]}</span></td></tr>`))}</div>`}`;
    $$('[data-tab]', main).forEach(b => b.onclick = () => { ordState.tab = b.dataset.tab; A.refresh(); });
    const search = () => { ordState.q = $('[data-q]', main).value; ordState.from = $('[data-from]', main)?.value || ''; ordState.to = $('[data-to]', main)?.value || ''; A.refresh(); };
    $('[data-search]', main).onclick = search; $('[data-q]', main).onkeydown = (e) => { if (e.key === 'Enter') search(); };
    $('[data-toggle-store]', main).onclick = async () => { const r = await A.api('/admin/store-open', { method: 'POST', body: { open: !open } }); A.config.store_open = r.store_open; A.toast(r.store_open ? 'Loja aberta para pedidos online' : 'Loja fechada para pedidos online'); A.refresh(); };
    $('[data-counter]', main).onclick = counterSale;
    main.onclick = (e) => {
      const b = e.target.closest('[data-act]'); const row = e.target.closest('[data-open]');
      if (b) orderAction(Number(b.dataset.id), b.dataset.act, list.find(o => o.id === Number(b.dataset.id)));
      else if (row) orderDetail(Number(row.dataset.open));
    };
  };
  function orderCard(o) {
    const mins = Math.round((Date.now() - new Date(o.created_at.replace(' ', 'T'))) / 6e4);
    return `<div class="order st-${o.status}">
      <div class="hd"><strong>#${o.id} · ${esc(o.customer_name)}</strong><span class="badge ${A.STATUS_BADGE[o.status]}">${A.STATUS[o.status]}</span></div>
      <div class="hint">${o.created_at.slice(11, 16)} (há ${mins} min) · ${A.MODE[o.mode]} · ${A.PAY[o.payment_method]} ${o.payment_status === 'paid' ? '<span class="badge b-ok">pago</span>' : o.payment_method === 'pix' ? '<span class="badge b-warn">PIX a conferir</span>' : ''}</div>
      <ul>${o.items.map(i => `<li><strong>${i.quantity}x</strong> ${esc(i.product_name)}${i.size_name ? ` (${esc(i.size_name)})` : ''}${i.addons.length ? `<br><span class="hint">+ ${i.addons.map(a => esc(a.name)).join(', ')}</span>` : ''}${i.notes ? `<br><em class="hint">Obs.: ${esc(i.notes)}</em>` : ''}</li>`).join('')}</ul>
      ${o.mode === 'delivery' ? `<div class="hint">📍 ${esc(o.address)}${o.address_ref ? ` — ${esc(o.address_ref)}` : ''}</div>` : ''}
      ${o.notes ? `<div class="hint">📝 ${esc(o.notes)}</div>` : ''}
      <div class="hd"><span>Total <strong>${money(o.total)}</strong>${o.change_for ? ` <span class="hint">· troco p/ ${money(o.change_for)}</span>` : ''}</span></div>
      <div class="acts">
        ${NEXT[o.status] ? `<button class="btn sm primary" data-act="next" data-id="${o.id}">${NEXT_LABEL(o)}</button>` : ''}
        ${o.status === 'received' ? `<button class="btn sm danger" data-act="reject" data-id="${o.id}">Recusar</button>` : ''}
        ${o.payment_status !== 'paid' && o.payment_method === 'pix' ? `<button class="btn sm" data-act="paid" data-id="${o.id}">Confirmar PIX</button>` : ''}
        <button class="btn sm" data-act="detail" data-id="${o.id}">Detalhes</button>
        ${o.customer_phone ? `<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/55${o.customer_phone.replace(/^55/, '')}?text=${encodeURIComponent(`Olá, ${o.customer_name.split(' ')[0]}! Sobre seu pedido #${o.id} na Supremo: ${location.origin}/pedido.html?c=${o.code}`)}">WhatsApp</a>` : ''}
        ${!['received'].includes(o.status) ? `<button class="btn sm danger" data-act="cancel" data-id="${o.id}">Cancelar</button>` : ''}
      </div></div>`;
  }
  async function orderAction(id, act, o) {
    try {
      if (act === 'detail') return orderDetail(id);
      if (act === 'next') {
        const next = NEXT[o.status];
        if (next === 'delivered' && o.payment_status !== 'paid') {
          const pixMsg = o.payment_method === 'pix' ? '<div class="alert warning">O PIX ainda não foi confirmado. Confirme somente se você conferiu o recebimento na conta.</div>' : '';
          return A.confirm('Concluir pedido', `${pixMsg}Confirmar que o pedido #${id} foi ${o.mode === 'delivery' ? 'entregue' : 'retirado'} e o pagamento de <strong>${money(o.total)}</strong> (${A.PAY[o.payment_method]}) foi recebido?`,
            async () => { await A.api(`/admin/orders/${id}/status`, { method: 'POST', body: { status: 'delivered', confirmPayment: true } }); A.toast('Pedido concluído'); A.refresh(); });
        }
        await A.api(`/admin/orders/${id}/status`, { method: 'POST', body: { status: next } });
        A.toast(A.STATUS[next]); return A.refresh();
      }
      if (act === 'paid') return A.confirm('Confirmar PIX', `Você conferiu no extrato do banco o recebimento de <strong>${money(o.total)}</strong> referente ao pedido #${id}? Esta conferência fica registrada em seu nome.`,
        async () => { await A.api(`/admin/orders/${id}/confirm-payment`, { method: 'POST' }); A.toast('Pagamento confirmado'); A.refresh(); });
      if (act === 'reject') return A.confirm('Recusar pedido', `Recusar o pedido #${id}? O cliente verá o motivo.`, async (reason) => { await A.api(`/admin/orders/${id}/status`, { method: 'POST', body: { status: 'rejected', reason } }); A.refresh(); }, { input: 'Motivo (ex.: fora da área de entrega)', danger: true });
      if (act === 'cancel') {
        return A.modal({
          title: `Cancelar pedido #${id}`, submit: 'Cancelar pedido',
          body: `<label class="field"><span>Motivo do cancelamento *</span><textarea name="reason" rows="2" required></textarea></label>
            ${o.status === 'preparing' || o.status === 'out_for_delivery' ? `<p>Os ingredientes já foram baixados do estoque. O que aconteceu com eles?</p>
            <label class="check"><input type="radio" name="lost" value="0" checked> Não foram usados — devolver ao estoque</label>
            <label class="check"><input type="radio" name="lost" value="1"> Já foram usados — registrar como perda</label>` : ''}`,
          onSubmit: async (f) => {
            const d = A.formData(f); if (!d.reason.trim()) throw new Error('Informe o motivo.');
            await A.api(`/admin/orders/${id}/status`, { method: 'POST', body: { status: 'cancelled', reason: d.reason, ingredientsLost: d.lost === '1' } });
            A.toast('Pedido cancelado'); A.refresh();
          }
        });
      }
    } catch (e) { A.toast(e.message); }
  }
  async function orderDetail(id) {
    const o = await A.api('/admin/orders/' + id);
    A.modal({
      title: `Pedido #${o.id}`, wide: true,
      body: `<div class="grid g2"><div>
        <p><strong>${esc(o.customer_name)}</strong>${o.customer_phone ? ` · ${esc(o.customer_phone)}` : ''}<br>${A.MODE[o.mode]} · ${A.PAY[o.payment_method]} · <span class="badge ${o.payment_status === 'paid' ? 'b-ok' : 'b-warn'}">${o.payment_status === 'paid' ? 'Pago' : 'Pagamento pendente'}</span>
        ${o.payment_confirmed_by ? `<br><span class="hint">Pagamento confirmado por: ${esc(o.payment_confirmed_by)}</span>` : ''}</p>
        ${o.mode === 'delivery' ? `<p>📍 ${esc(o.address)}<br><span class="hint">${esc(o.address_ref)}</span></p>` : ''}
        ${o.notes ? `<p>📝 ${esc(o.notes)}</p>` : ''}${o.cancel_reason ? `<div class="alert warning">Motivo: ${esc(o.cancel_reason)}</div>` : ''}
        <p class="hint">Código: ${esc(o.code)} · <a href="/pedido.html?c=${o.code}" target="_blank">página do cliente ↗</a></p></div>
        <div><h3>Histórico</h3>${o.history.map(h => `<div class="hint">${A.br(h.created_at)} — <strong>${A.STATUS[h.status]}</strong>${h.user_name ? ` · ${esc(h.user_name)}` : ''}${h.note ? ` · ${esc(h.note)}` : ''}</div>`).join('')}
        <p class="hint" style="margin-top:8px">Baixa de estoque: ${o.stock_deducted ? 'realizada' : 'ainda não'}${o.cost_estimate ? ` · custo estimado ${money(o.cost_estimate)}` : ''}</p></div></div>
        ${A.table([{ t: 'Item' }, { t: 'Qtd', num: 1 }, { t: 'Unit.', num: 1 }, { t: 'Total', num: 1 }], o.items.map(i => `<tr><td>${esc(i.product_name)}${i.size_name ? ` (${esc(i.size_name)})` : ''}${i.addons.length ? `<br><span class="hint">+ ${i.addons.map(a => esc(a.name)).join(', ')}</span>` : ''}${i.notes ? `<br><em class="hint">${esc(i.notes)}</em>` : ''}</td><td class="num">${i.quantity}</td><td class="num">${money(i.unit_price)}</td><td class="num">${money(i.total)}</td></tr>`))}
        <p style="text-align:right">Subtotal ${money(o.subtotal)} · Entrega ${money(o.delivery_fee)} · <strong>Total ${money(o.total)}</strong></p>`,
      extraButtons: '<button type="button" class="btn" data-print>Imprimir comanda</button>',
      onOpen: (f) => { f.querySelector('[data-print]').onclick = () => printTicket(o); }
    });
  }
  function printTicket(o) {
    const w = window.open('', '_blank', 'width=380,height=600');
    w.document.write(`<html><head><title>Pedido ${o.id}</title><style>body{font:13px monospace;margin:10px;width:280px}h2{margin:0;text-align:center}hr{border:0;border-top:1px dashed #000}</style></head><body>
      <h2>SUPREMO AÇAÍ</h2><p style="text-align:center">Pedido #${o.id}<br>${A.br(o.created_at)}</p><hr>
      ${o.items.map(i => `<p><b>${i.quantity}x ${esc(i.product_name)}${i.size_name ? ` (${esc(i.size_name)})` : ''}</b>${i.addons.length ? `<br>+ ${i.addons.map(a => esc(a.name)).join(', ')}` : ''}${i.notes ? `<br>OBS: ${esc(i.notes)}` : ''}<br>${money(i.total)}</p>`).join('')}<hr>
      <p>Subtotal: ${money(o.subtotal)}<br>Entrega: ${money(o.delivery_fee)}<br><b>TOTAL: ${money(o.total)}</b><br>Pagamento: ${A.PAY[o.payment_method]} ${o.payment_status === 'paid' ? '(PAGO)' : ''}${o.change_for ? `<br>Troco para: ${money(o.change_for)}` : ''}</p><hr>
      <p>${esc(o.customer_name)}<br>${esc(o.customer_phone)}<br>${o.mode === 'delivery' ? esc(o.address) + '<br>' + esc(o.address_ref) : A.MODE[o.mode]}</p>${o.notes ? `<p>OBS: ${esc(o.notes)}</p>` : ''}
      </body></html>`);
    w.document.close(); w.focus(); w.print();
  }
  async function counterSale() {
    const cat = await A.api('/admin/catalog');
    const prods = [...cat.categories.flatMap(c => c.products), ...cat.uncategorized].filter(p => p.active);
    if (!prods.length) return A.toast('Cadastre produtos primeiro.');
    const opt = prods.map(p => p.sizes.filter(s => s.active).length ? p.sizes.filter(s => s.active).map(s => `<option value="${p.id}:${s.id}">${esc(p.name)} — ${esc(s.name)} (${money(s.promo_price)})</option>`).join('') : `<option value="${p.id}:">${esc(p.name)} (${money(p.promo_price)})</option>`).join('');
    const lineHtml = () => `<div class="line"><select data-prod>${opt}</select><input type="number" min="1" value="1" data-qty><button type="button" class="btn sm danger" data-rm>×</button></div>`;
    A.modal({
      title: 'Venda no balcão', submit: 'Registrar venda',
      body: `<div class="lines" id="cLines">${lineHtml()}</div><button type="button" class="btn sm" data-add>+ Item</button>
        <p class="hint">Adicionais podem ser descritos na observação. Para adicionais com preço, use o pedido online.</p>
        <div class="row" style="margin-top:12px"><label class="field"><span>Cliente (opcional)</span><input name="customer_name"></label>
        <label class="field"><span>Pagamento</span><select name="payment_method">${Object.entries(A.PAY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field"><span>Tipo</span><select name="mode"><option value="local">Consumo no local</option><option value="pickup">Para viagem</option></select></label></div>
        <label class="field"><span>Observações</span><input name="notes"></label>
        <label class="check"><input type="checkbox" name="finish_now" checked> Já entregue e pago (finalizar agora)</label>`,
      onOpen: (f) => {
        f.querySelector('[data-add]').onclick = () => f.querySelector('#cLines').insertAdjacentHTML('beforeend', lineHtml());
        f.onclick = (e) => { if (e.target.matches('[data-rm]') && f.querySelectorAll('.line').length > 1) e.target.closest('.line').remove(); };
      },
      onSubmit: async (f) => {
        const d = A.formData(f);
        d.items = $$('.line', f).map(l => { const [pid, sid] = l.querySelector('[data-prod]').value.split(':'); return { product_id: Number(pid), size_id: sid ? Number(sid) : null, quantity: Number(l.querySelector('[data-qty]').value) }; });
        const o = await A.api('/admin/orders', { method: 'POST', body: d });
        A.toast(`Venda #${o.id} registrada: ${money(o.total)}`); A.refresh();
      }
    });
  }

  // ======================================================================
  // PRODUTOS (categorias, produtos, adicionais, promoções)
  // ======================================================================
  let prodTab = 'products';
  A.sections.products = async (main) => {
    const cat = await A.api('/admin/catalog');
    A.catalog = cat;
    const prods = [...cat.categories.flatMap(c => c.products), ...cat.uncategorized];
    const catName = (id) => cat.categories.find(c => c.id === id)?.name || '—';
    main.innerHTML = `<div class="topline"><h1>Produtos</h1>
      <button class="btn primary" data-new>${{ products: '+ Produto', categories: '+ Categoria', addons: '+ Grupo de adicionais', promos: '+ Promoção' }[prodTab]}</button></div>
      <div class="filters"><div class="seg">${[['products', 'Produtos'], ['categories', 'Categorias'], ['addons', 'Adicionais'], ['promos', 'Promoções']].map(([k, l]) => `<button data-tab="${k}" class="${prodTab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="card" id="pBody"></div>`;
    const body = $('#pBody', main);
    if (prodTab === 'products') {
      body.innerHTML = (cat.categories.length ? '' : '<div class="alert info" style="margin-bottom:12px">Comece criando as categorias do cardápio oficial (ex.: Açaí, Petiscos, Bebidas).</div>') +
        A.table([{ t: '' }, { t: 'Produto' }, { t: 'Categoria' }, { t: 'Preço', num: 1 }, { t: 'Situação' }, { t: '' }], prods.map(p => `<tr class="${p.active ? '' : 'muted'}">
        <td>${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : '<div class="thumb"></div>'}</td>
        <td><strong>${esc(p.name)}</strong>${p.featured ? ' <span class="badge b-warn">destaque</span>' : ''}<br><span class="hint">${esc(p.description).slice(0, 90)}</span></td>
        <td>${esc(catName(p.category_id))}</td>
        <td class="num">${p.sizes.filter(s => s.active).length ? p.sizes.filter(s => s.active).map(s => `${esc(s.name)}: ${money(s.price)}`).join('<br>') : money(p.price)}</td>
        <td><span class="badge ${p.active ? 'b-ok' : 'b-gray'}">${p.active ? 'Ativo' : 'Inativo'}</span></td>
        <td class="num"><button class="btn sm" data-edit="${p.id}">Editar</button> <button class="btn sm danger" data-del="${p.id}">Remover</button></td></tr>`), 'Nenhum produto cadastrado. Cadastre conforme o cardápio oficial.');
      body.onclick = (e) => {
        const ed = e.target.closest('[data-edit]'); const del = e.target.closest('[data-del]');
        if (ed) productForm(prods.find(p => p.id === Number(ed.dataset.edit)));
        if (del) A.confirm('Remover produto', 'Produtos que já têm vendas são apenas desativados para manter o histórico. Continuar?', async () => { const r = await A.api('/admin/products/' + del.dataset.del, { method: 'DELETE' }); A.toast(r.deactivated ? 'Produto desativado' : 'Produto removido'); A.refresh(); }, { danger: true });
      };
    } else if (prodTab === 'categories') {
      body.innerHTML = A.table([{ t: 'Ordem' }, { t: 'Categoria' }, { t: 'Produtos', num: 1 }, { t: 'Situação' }, { t: '' }], cat.categories.map(c => `<tr class="${c.active ? '' : 'muted'}"><td>${c.sort}</td><td><strong>${esc(c.name)}</strong></td><td class="num">${c.products.length}</td>
        <td><span class="badge ${c.active ? 'b-ok' : 'b-gray'}">${c.active ? 'Ativa' : 'Inativa'}</span></td><td class="num"><button class="btn sm" data-edit="${c.id}">Editar</button> <button class="btn sm danger" data-del="${c.id}">Excluir</button></td></tr>`), 'Nenhuma categoria.');
      body.onclick = (e) => {
        const ed = e.target.closest('[data-edit]'); const del = e.target.closest('[data-del]');
        if (ed) categoryForm(cat.categories.find(c => c.id === Number(ed.dataset.edit)));
        if (del) A.confirm('Excluir categoria', 'Só é possível excluir categorias sem produtos.', async () => { await A.api('/admin/categories/' + del.dataset.del, { method: 'DELETE' }); A.refresh(); }, { danger: true });
      };
    } else if (prodTab === 'addons') {
      body.innerHTML = '<p class="hint">Grupos de adicionais (ex.: "Complementos", "Caldas", "Frutas"). Depois vincule o grupo aos produtos no cadastro do produto.</p>' +
        A.table([{ t: 'Grupo' }, { t: 'Regra' }, { t: 'Opções' }, { t: '' }], cat.addon_groups.map(g => `<tr class="${g.active ? '' : 'muted'}"><td><strong>${esc(g.name)}</strong></td>
        <td>${g.min_select ? `mín. ${g.min_select}` : 'opcional'}${g.max_select ? ` · máx. ${g.max_select}` : ''}</td>
        <td>${g.addons.filter(a => a.active).map(a => `${esc(a.name)} <span class="hint">${a.price ? money(a.price) : 'grátis'}</span>`).join(' · ')}</td>
        <td class="num"><button class="btn sm" data-edit="${g.id}">Editar</button></td></tr>`), 'Nenhum grupo de adicionais.');
      body.onclick = (e) => { const ed = e.target.closest('[data-edit]'); if (ed) groupForm(cat.addon_groups.find(g => g.id === Number(ed.dataset.edit))); };
    } else {
      body.innerHTML = A.table([{ t: 'Promoção' }, { t: 'Produto' }, { t: 'Desconto' }, { t: 'Período' }, { t: 'Situação' }, { t: '' }], cat.promotions_all.map(p => `<tr class="${p.active ? '' : 'muted'}"><td><strong>${esc(p.title)}</strong><br><span class="hint">${esc(p.description)}</span></td>
        <td>${esc(prods.find(x => x.id === p.product_id)?.name || '—')}</td><td>${p.discount_type === 'percent' ? p.discount_value + '%' : p.discount_type === 'fixed' ? money(p.discount_value) : 'Só divulgação'}</td>
        <td>${p.starts_at ? A.br(p.starts_at) : 'já'} → ${p.ends_at ? A.br(p.ends_at) : 'sem fim'}</td><td><span class="badge ${p.active ? 'b-ok' : 'b-gray'}">${p.active ? 'Ativa' : 'Encerrada'}</span></td>
        <td class="num"><button class="btn sm" data-edit="${p.id}">Editar</button> ${p.active ? `<button class="btn sm danger" data-del="${p.id}">Encerrar</button>` : ''}</td></tr>`), 'Nenhuma promoção.');
      body.onclick = (e) => {
        const ed = e.target.closest('[data-edit]'); const del = e.target.closest('[data-del]');
        if (ed) promoForm(cat.promotions_all.find(p => p.id === Number(ed.dataset.edit)), prods);
        if (del) A.confirm('Encerrar promoção', 'Encerrar esta promoção agora?', async () => { await A.api('/admin/promotions/' + del.dataset.del, { method: 'DELETE' }); A.refresh(); });
      };
    }
    $$('[data-tab]', main).forEach(b => b.onclick = () => { prodTab = b.dataset.tab; A.refresh(); });
    $('[data-new]', main).onclick = () => ({ products: () => productForm(null), categories: () => categoryForm(null), addons: () => groupForm(null), promos: () => promoForm(null, prods) }[prodTab])();
  };
  function categoryForm(c) {
    A.modal({
      title: c ? 'Editar categoria' : 'Nova categoria',
      body: `<label class="field"><span>Nome</span><input name="name" value="${esc(c?.name)}" required></label>
        <label class="field"><span>Ordem no cardápio</span><input name="sort" type="number" value="${c?.sort ?? 0}"></label>
        <label class="check"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> Ativa (visível no cardápio)</label>`,
      onSubmit: async (f) => { await A.api('/admin/categories' + (c ? '/' + c.id : ''), { method: c ? 'PUT' : 'POST', body: A.formData(f) }); A.refresh(); }
    });
  }
  function productForm(p) {
    const cat = A.catalog;
    const sizes = p ? p.sizes.filter(s => s.active) : [];
    const sizeLine = (s = {}) => `<div class="line"><input placeholder="Tamanho (ex.: 500 ml)" data-sname value="${esc(s.name)}"><input placeholder="Preço" inputmode="decimal" data-sprice value="${s.price ? A.toReais(s.price) : ''}"><input type="hidden" data-sid value="${s.id || ''}"><button type="button" class="btn sm danger" data-rm>×</button></div>`;
    const linked = new Set((p?.addon_groups || []).map(g => g.id));
    A.modal({
      title: p ? 'Editar produto' : 'Novo produto', wide: true,
      body: `<div class="grid g2"><div>
        <label class="field"><span>Nome *</span><input name="name" value="${esc(p?.name)}" required></label>
        <label class="field"><span>Categoria</span><select name="category_id"><option value="">—</option>${cat.categories.map(c => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Descrição</span><textarea name="description" rows="3">${esc(p?.description)}</textarea></label>
        ${A.imageField('image', p?.image)}
        <div class="row"><label class="field"><span>Ordem</span><input name="sort" type="number" value="${p?.sort ?? 0}"></label></div>
        <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Ativo no cardápio</label>
        <label class="check"><input type="checkbox" name="featured" ${p?.featured ? 'checked' : ''}> Destaque na página inicial ("Mais pedidos")</label>
      </div><div>
        <h3>Preço</h3>
        <label class="field"><span>Preço único (se o produto não tiver tamanhos)</span><input name="price" inputmode="decimal" value="${p && p.price ? A.toReais(p.price) : ''}" placeholder="0,00"></label>
        <h3>Tamanhos <span class="hint">(opcional — cada tamanho com seu preço)</span></h3>
        <div class="lines" id="sizes">${sizes.map(sizeLine).join('')}</div><button type="button" class="btn sm" data-addsize>+ Tamanho</button>
        <h3 style="margin-top:16px">Adicionais disponíveis</h3>
        ${cat.addon_groups.filter(g => g.active).map(g => `<label class="check"><input type="checkbox" data-group="${g.id}" data-skip ${linked.has(g.id) ? 'checked' : ''}> ${esc(g.name)} <span class="hint">(${g.addons.filter(a => a.active).length} opções)</span></label>`).join('') || '<p class="hint">Crie grupos na aba "Adicionais".</p>'}
      </div></div>`,
      onOpen: (f) => {
        A.bindImages(f);
        f.querySelector('[data-addsize]').onclick = () => f.querySelector('#sizes').insertAdjacentHTML('beforeend', sizeLine());
        f.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.closest('.line').remove(); });
      },
      onSubmit: async (f) => {
        const d = A.formData(f);
        d.sizes = $$('#sizes .line', f).map(l => ({ id: l.querySelector('[data-sid]').value || null, name: l.querySelector('[data-sname]').value, price: l.querySelector('[data-sprice]').value })).filter(s => s.name.trim());
        d.addon_group_ids = $$('[data-group]', f).filter(c => c.checked).map(c => Number(c.dataset.group));
        await A.api('/admin/products' + (p ? '/' + p.id : ''), { method: p ? 'PUT' : 'POST', body: d });
        A.toast('Produto salvo'); A.refresh();
      }
    });
  }
  function groupForm(g) {
    const line = (a = {}) => `<div class="line"><input placeholder="Nome (ex.: Granola)" data-n value="${esc(a.name)}"><input placeholder="Preço (0 = grátis)" inputmode="decimal" data-p value="${a.price != null ? A.toReais(a.price) : ''}"><input type="hidden" data-id value="${a.id || ''}"><button type="button" class="btn sm danger" data-rm>×</button></div>`;
    A.modal({
      title: g ? 'Editar grupo de adicionais' : 'Novo grupo de adicionais',
      body: `<label class="field"><span>Nome do grupo</span><input name="name" value="${esc(g?.name)}" placeholder="Ex.: Complementos" required></label>
        <div class="row"><label class="field"><span>Mínimo de escolhas (0 = opcional)</span><input name="min_select" type="number" min="0" value="${g?.min_select ?? 0}"></label>
        <label class="field"><span>Máximo de escolhas (0 = sem limite)</span><input name="max_select" type="number" min="0" value="${g?.max_select ?? 0}"></label></div>
        <label class="check"><input type="checkbox" name="active" ${!g || g.active ? 'checked' : ''}> Ativo</label>
        <h3>Opções</h3><div class="lines" id="ad">${(g?.addons.filter(a => a.active) || []).map(line).join('') || line()}</div><button type="button" class="btn sm" data-add>+ Opção</button>`,
      onOpen: (f) => { f.querySelector('[data-add]').onclick = () => f.querySelector('#ad').insertAdjacentHTML('beforeend', line()); f.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.closest('.line').remove(); }); },
      onSubmit: async (f) => {
        const d = A.formData(f);
        d.addons = $$('#ad .line', f).map(l => ({ id: l.querySelector('[data-id]').value || null, name: l.querySelector('[data-n]').value, price: l.querySelector('[data-p]').value || 0 })).filter(a => a.name.trim());
        await A.api('/admin/addon-groups' + (g ? '/' + g.id : ''), { method: g ? 'PUT' : 'POST', body: d }); A.refresh();
      }
    });
  }
  function promoForm(p, prods) {
    A.modal({
      title: p ? 'Editar promoção' : 'Nova promoção',
      body: `<label class="field"><span>Título</span><input name="title" value="${esc(p?.title)}" required></label>
        <label class="field"><span>Descrição</span><textarea name="description" rows="2">${esc(p?.description)}</textarea></label>
        ${A.imageField('image', p?.image, 'Imagem do banner')}
        <div class="row"><label class="field"><span>Produto</span><select name="product_id"><option value="">— (só divulgação)</option>${prods.filter(x => x.active).map(x => `<option value="${x.id}" ${p?.product_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Tipo de desconto</span><select name="discount_type"><option value="none">Sem desconto</option><option value="percent" ${p?.discount_type === 'percent' ? 'selected' : ''}>Percentual (%)</option><option value="fixed" ${p?.discount_type === 'fixed' ? 'selected' : ''}>Valor (R$)</option></select></label>
        <label class="field"><span>Valor do desconto</span><input name="discount_value" inputmode="decimal" value="${p ? (p.discount_type === 'fixed' ? A.toReais(p.discount_value) : p.discount_value) : ''}"></label></div>
        <div class="row"><label class="field"><span>Início</span><input type="datetime-local" name="starts_at" value="${p?.starts_at ? p.starts_at.replace(' ', 'T').slice(0, 16) : ''}"></label>
        <label class="field"><span>Fim</span><input type="datetime-local" name="ends_at" value="${p?.ends_at ? p.ends_at.replace(' ', 'T').slice(0, 16) : ''}"></label></div>
        <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Ativa</label>`,
      onOpen: A.bindImages,
      onSubmit: async (f) => { await A.api('/admin/promotions' + (p ? '/' + p.id : ''), { method: p ? 'PUT' : 'POST', body: A.formData(f) }); A.refresh(); }
    });
  }

  window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
})();
