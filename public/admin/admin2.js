// Painel gerencial — Estoque, Movimentações, Fichas técnicas, Financeiro, Caixa,
// Fornecedores/Compras, Funcionários, Relatórios e Configurações.
(function () {
  const A = window.Admin; const { $, $$, esc, money } = A;
  const REASONS_IN = { compra: 'Compra de mercadoria', reposicao: 'Reposição', devolucao: 'Devolução', ajuste_pos: 'Ajuste positivo' };
  const REASONS_OUT = { producao: 'Utilização na produção', perda: 'Perda', vencido: 'Produto vencido', dano: 'Dano', ajuste_neg: 'Ajuste negativo' };
  const REASON_ALL = { ...REASONS_IN, ...REASONS_OUT, estorno_cancelamento: 'Estorno de cancelamento' };
  const UNITS = ['kg', 'g', 'l', 'ml', 'un', 'cx', 'pct'];
  const STOCK_CATS = ['Ingredientes', 'Frutas', 'Coberturas e caldas', 'Carnes e frios', 'Embalagens', 'Descartáveis', 'Bebidas', 'Limpeza', 'Outros'];
  const stockBadge = (s) => s.quantity <= 0 ? '<span class="badge b-danger">Esgotado</span>' : s.quantity <= s.min_quantity ? '<span class="badge b-warn">Repor</span>' : '<span class="badge b-ok">OK</span>';
  const expBadge = (d) => { if (!d) return ''; const t = A.today(); const lim = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10); return d < t ? ` <span class="badge b-danger">vencido</span>` : d <= lim ? ` <span class="badge b-warn">vence logo</span>` : ''; };

  // ======================================================================
  // ESTOQUE
  // ======================================================================
  A.sections.stock = async (main) => {
    const [items, sups] = await Promise.all([A.api('/admin/stock'), A.api('/admin/suppliers').catch(() => [])]);
    const total = items.filter(i => i.active).reduce((s, i) => s + Math.max(0, i.quantity) * i.unit_cost, 0);
    main.innerHTML = `<div class="topline"><h1>Estoque</h1>${A.can('stock') ? '<button class="btn primary" data-new>+ Item de estoque</button>' : ''}</div>
      <div class="grid kpis" style="margin-bottom:14px">
        <div class="kpi"><div class="l">Valor total em estoque</div><div class="v">${money(Math.round(total))}</div></div>
        <div class="kpi"><div class="l">Itens cadastrados</div><div class="v">${items.filter(i => i.active).length}</div></div>
        <div class="kpi"><div class="l">Estoque baixo</div><div class="v">${items.filter(i => i.active && i.quantity > 0 && i.quantity <= i.min_quantity).length}</div></div>
        <div class="kpi"><div class="l">Esgotados</div><div class="v">${items.filter(i => i.active && i.quantity <= 0).length}</div></div>
      </div>
      <div class="filters"><input type="search" placeholder="Buscar item" data-q> <select data-cat><option value="">Todas as categorias</option>${[...new Set(items.map(i => i.category))].map(c => `<option>${esc(c)}</option>`).join('')}</select>
      <label class="check" style="margin:0"><input type="checkbox" data-low> Só itens para repor</label></div>
      <div class="card" id="sBody"></div>`;
    const draw = () => {
      const q = $('[data-q]', main).value.toLowerCase(); const c = $('[data-cat]', main).value; const low = $('[data-low]', main).checked;
      const rows = items.filter(i => (!q || i.name.toLowerCase().includes(q)) && (!c || i.category === c) && (!low || i.quantity <= i.min_quantity));
      $('#sBody', main).innerHTML = A.table([{ t: 'Item' }, { t: 'Categoria' }, { t: 'Atual', num: 1 }, { t: 'Mínimo', num: 1 }, { t: 'Custo/un.', num: 1 }, { t: 'Valor', num: 1 }, { t: 'Fornecedor' }, { t: 'Última entrada' }, { t: 'Validade' }, { t: 'Situação' }, { t: '' }],
        rows.map(i => `<tr class="${i.active ? '' : 'muted'}"><td><strong>${esc(i.name)}</strong></td><td>${esc(i.category)}</td>
          <td class="num">${A.qty(i.quantity)} ${esc(i.unit)}</td><td class="num">${A.qty(i.min_quantity)}</td><td class="num">${money(i.unit_cost)}</td>
          <td class="num">${money(Math.round(Math.max(0, i.quantity) * i.unit_cost))}</td><td>${esc(i.supplier_name || '—')}</td><td>${A.br(i.last_entry_at)}</td>
          <td>${i.expires_at ? A.br(i.expires_at) + expBadge(i.expires_at) : '—'}</td><td>${stockBadge(i)}</td>
          <td class="num">${A.can('movements') ? `<button class="btn sm" data-mov="${i.id}">Movimentar</button> ` : ''}${A.can('stock') ? `<button class="btn sm" data-edit="${i.id}">Editar</button>` : ''}</td></tr>`),
        'Nenhum item. Cadastre matérias-primas, ingredientes, embalagens e bebidas.');
    };
    draw();
    main.oninput = draw;
    $('[data-new]', main) && ($('[data-new]', main).onclick = () => stockForm(null, sups));
    main.onclick = (e) => {
      const ed = e.target.closest('[data-edit]'); const mv = e.target.closest('[data-mov]');
      if (ed) stockForm(items.find(i => i.id === Number(ed.dataset.edit)), sups);
      if (mv) movementForm(items, Number(mv.dataset.mov));
    };
  };
  function stockForm(i, sups) {
    A.modal({
      title: i ? 'Editar item de estoque' : 'Novo item de estoque',
      body: `<label class="field"><span>Nome *</span><input name="name" value="${esc(i?.name)}" required></label>
        <div class="row"><label class="field"><span>Categoria</span><select name="category">${[...new Set([...STOCK_CATS, i?.category].filter(Boolean))].map(c => `<option ${i?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span>Unidade de medida *</span><select name="unit">${UNITS.map(u => `<option ${i?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label></div>
        <div class="row">${i ? `<div class="field"><span>Quantidade atual</span><div style="padding:9px 0"><strong>${A.qty(i.quantity)} ${esc(i.unit)}</strong> <span class="hint">— altera só por movimentação</span></div></div>`
          : '<label class="field"><span>Quantidade inicial</span><input name="quantity" inputmode="decimal" placeholder="0"></label>'}
        <label class="field"><span>Estoque mínimo</span><input name="min_quantity" inputmode="decimal" value="${i?.min_quantity ?? ''}"></label>
        <label class="field"><span>Custo por unidade (R$)</span><input name="unit_cost" inputmode="decimal" value="${i ? A.toReais(i.unit_cost) : ''}" placeholder="por ${i?.unit || 'unidade de medida'}"></label></div>
        <p class="hint">Ex.: açaí comprado a R$ 20,00 o litro, cadastrado em ml → custo 0,02 por ml. O custo é recalculado (média ponderada) a cada compra.</p>
        <div class="row"><label class="field"><span>Fornecedor</span><select name="supplier_id"><option value="">—</option>${sups.map(s => `<option value="${s.id}" ${i?.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Validade</span><input type="date" name="expires_at" value="${i?.expires_at || ''}"></label></div>
        <label class="check"><input type="checkbox" name="active" ${!i || i.active ? 'checked' : ''}> Ativo</label>`,
      onSubmit: async (f) => {
        const d = A.formData(f); d.min_quantity = String(d.min_quantity).replace(',', '.'); if (d.quantity) d.quantity = String(d.quantity).replace(',', '.');
        await A.api('/admin/stock' + (i ? '/' + i.id : ''), { method: i ? 'PUT' : 'POST', body: d }); A.toast('Item salvo'); A.refresh();
      }
    });
  }
  function movementForm(items, itemId) {
    A.modal({
      title: 'Registrar movimentação',
      body: `<label class="field"><span>Item *</span><select name="item_id">${items.filter(i => i.active).map(i => `<option value="${i.id}" ${i.id === itemId ? 'selected' : ''}>${esc(i.name)} (${A.qty(i.quantity)} ${esc(i.unit)})</option>`).join('')}</select></label>
        <div class="row"><label class="field"><span>Tipo *</span><select name="direction"><option value="in">Entrada</option><option value="out">Saída</option></select></label>
        <label class="field"><span>Motivo *</span><select name="reason"></select></label></div>
        <div class="row"><label class="field"><span>Quantidade *</span><input name="quantity" inputmode="decimal" required></label>
        <label class="field" data-cost><span>Custo por unidade (R$)</span><input name="unit_cost" inputmode="decimal" placeholder="opcional"></label>
        <label class="field" data-exp><span>Validade do lote</span><input type="date" name="expires_at"></label></div>
        <label class="field"><span>Observação / motivo detalhado</span><input name="note" placeholder="Obrigatório para perdas e ajustes"></label>
        <p class="hint">Movimentações não podem ser apagadas. Para corrigir um lançamento, registre um ajuste com o motivo.</p>`,
      onOpen: (f) => {
        const upd = () => {
          const dir = f.elements.direction.value;
          f.elements.reason.innerHTML = Object.entries(dir === 'in' ? REASONS_IN : REASONS_OUT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
          f.querySelector('[data-cost]').hidden = dir !== 'in'; f.querySelector('[data-exp]').hidden = dir !== 'in';
        };
        f.elements.direction.onchange = upd; upd();
      },
      onSubmit: async (f) => {
        const d = A.formData(f); if (d.direction === 'out') { delete d.unit_cost; delete d.expires_at; }
        const r = await A.api('/admin/movements', { method: 'POST', body: d });
        A.toast(`Movimentação registrada. Saldo: ${A.qty(r.balance)}`); A.refresh();
      }
    });
  }

  // ======================================================================
  // ENTRADAS E SAÍDAS
  // ======================================================================
  const movState = { from: '', to: '', direction: '', item_id: '' };
  A.sections.movements = async (main) => {
    const q = new URLSearchParams(movState);
    const [movs, items] = await Promise.all([A.api('/admin/movements?' + q), A.api('/admin/stock')]);
    main.innerHTML = `<div class="topline"><h1>Entradas e saídas</h1>${A.can('movements') ? '<button class="btn primary" data-new>+ Registrar movimentação</button>' : ''}</div>
      <div class="filters"><select data-f="item_id"><option value="">Todos os itens</option>${items.map(i => `<option value="${i.id}" ${String(i.id) === movState.item_id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
      <select data-f="direction"><option value="">Entradas e saídas</option><option value="in" ${movState.direction === 'in' ? 'selected' : ''}>Só entradas</option><option value="out" ${movState.direction === 'out' ? 'selected' : ''}>Só saídas</option></select>
      <input type="date" data-f="from" value="${movState.from}"> <input type="date" data-f="to" value="${movState.to}"><button class="btn sm" data-go>Filtrar</button></div>
      <div class="card">${A.table([{ t: 'Data/hora' }, { t: 'Item' }, { t: 'Tipo' }, { t: 'Motivo' }, { t: 'Quantidade', num: 1 }, { t: 'Valor', num: 1 }, { t: 'Saldo após', num: 1 }, { t: 'Responsável' }, { t: 'Observação' }],
        movs.map(m => `<tr><td>${A.br(m.created_at)}</td><td>${esc(m.item_name)}</td><td><span class="badge ${m.direction === 'in' ? 'b-ok' : 'b-danger'}">${m.direction === 'in' ? 'Entrada' : 'Saída'}</span></td>
          <td>${REASON_ALL[m.reason] || esc(m.reason)}</td><td class="num">${m.direction === 'in' ? '+' : '−'}${A.qty(m.quantity)} ${esc(m.unit)}</td><td class="num">${money(m.total_value)}</td>
          <td class="num">${m.balance_after != null ? A.qty(m.balance_after) : ''}</td><td>${esc(m.user_name || 'Sistema')}</td><td>${esc(m.note)}${m.order_id ? ` <a href="#orders">#${m.order_id}</a>` : ''}</td></tr>`),
        'Nenhuma movimentação no filtro.')}</div>`;
    $('[data-go]', main).onclick = () => { $$('[data-f]', main).forEach(el => movState[el.dataset.f] = el.value); A.refresh(); };
    $('[data-new]', main) && ($('[data-new]', main).onclick = () => movementForm(items));
  };

  // ======================================================================
  // FICHAS TÉCNICAS
  // ======================================================================
  A.sections.recipes = async (main) => {
    const [cat, items, recipes] = await Promise.all([A.api('/admin/catalog'), A.api('/admin/stock'), A.api('/admin/recipes')]);
    const prods = [...cat.categories.flatMap(c => c.products), ...cat.uncategorized].filter(p => p.active);
    const costOf = (rows) => rows.reduce((s, r) => s + r.quantity * r.unit_cost, 0);
    const prodRows = prods.map(p => {
      const rs = recipes.filter(r => r.product_id === p.id);
      const sizes = p.sizes.filter(s => s.active);
      const variants = sizes.length ? sizes.map(s => ({ name: s.name, price: s.price, rows: rs.filter(r => r.size_id == null || r.size_id === s.id) })) : [{ name: '', price: p.price, rows: rs }];
      return `<tr><td><strong>${esc(p.name)}</strong></td><td>${rs.length ? `${rs.length} ingrediente(s)` : '<span class="badge b-warn">sem ficha</span>'}</td>
        <td>${variants.map(v => { const c = costOf(v.rows); return `${v.name ? esc(v.name) + ': ' : ''}custo ${money(Math.round(c))} · margem ${v.price ? Math.round((v.price - c) / v.price * 100) + '%' : '—'}`; }).join('<br>')}</td>
        <td class="num"><button class="btn sm" data-p="${p.id}">Editar ficha</button></td></tr>`;
    });
    const addons = cat.addon_groups.flatMap(g => g.addons.filter(a => a.active).map(a => ({ ...a, group: g.name })));
    main.innerHTML = `<div class="topline"><h1>Fichas técnicas</h1></div>
      <div class="alert info" style="margin-bottom:14px">A ficha técnica define quanto de cada ingrediente um produto consome. Quando o pedido entra em <strong>preparação</strong>, o sistema dá baixa automática no estoque (uma única vez por pedido).</div>
      ${!items.length ? '<div class="alert warning" style="margin-bottom:14px">Cadastre os itens de estoque antes de montar as fichas.</div>' : ''}
      <div class="card" style="margin-bottom:14px"><h2>Produtos</h2>${A.table([{ t: 'Produto' }, { t: 'Ficha' }, { t: 'Custo e margem estimada' }, { t: '' }], prodRows, 'Nenhum produto ativo.')}</div>
      <div class="card"><h2>Adicionais</h2><p class="hint">Ex.: o adicional "Granola" consome 20 g de granola.</p>${A.table([{ t: 'Adicional' }, { t: 'Grupo' }, { t: 'Ingredientes' }, { t: '' }], addons.map(a => {
        const rs = recipes.filter(r => r.addon_id === a.id);
        return `<tr><td>${esc(a.name)}</td><td>${esc(a.group)}</td><td>${rs.map(r => `${A.qty(r.quantity)} ${esc(r.unit)} ${esc(r.item_name)}`).join(', ') || '—'}</td><td class="num"><button class="btn sm" data-a="${a.id}">Editar</button></td></tr>`;
      }), 'Nenhum adicional.')}</div>`;
    main.onclick = (e) => {
      const p = e.target.closest('[data-p]'); const a = e.target.closest('[data-a]');
      if (p) recipeForm('product', prods.find(x => x.id === Number(p.dataset.p)), items, recipes);
      if (a) recipeForm('addon', addons.find(x => x.id === Number(a.dataset.a)), items, recipes);
    };
  };
  function recipeForm(kind, obj, items, recipes) {
    const rs = recipes.filter(r => (kind === 'product' ? r.product_id : r.addon_id) === obj.id);
    const sizes = kind === 'product' ? obj.sizes.filter(s => s.active) : [];
    const line = (r = {}) => `<div class="line ${sizes.length ? 'l4' : ''}"><select data-i>${items.filter(i => i.active).map(i => `<option value="${i.id}" ${r.stock_item_id === i.id ? 'selected' : ''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select>
      <input data-q inputmode="decimal" placeholder="Quantidade" value="${r.quantity ?? ''}">
      ${sizes.length ? `<select data-s><option value="">Todos os tamanhos</option>${sizes.map(s => `<option value="${s.id}" ${r.size_id === s.id ? 'selected' : ''}>Só ${esc(s.name)}</option>`).join('')}</select>` : ''}
      <button type="button" class="btn sm danger" data-rm>×</button></div>`;
    A.modal({
      title: `Ficha técnica — ${obj.name}`, wide: true,
      body: `<p class="hint">Informe a quantidade na unidade de medida do item de estoque.${sizes.length ? ' Ingredientes comuns (ex.: embalagem) podem valer para "todos os tamanhos"; os específicos, para cada tamanho.' : ''}</p>
        <div class="lines" id="rl">${rs.map(line).join('') || line()}</div><button type="button" class="btn sm" data-add>+ Ingrediente</button>`,
      onOpen: (f) => { f.querySelector('[data-add]').onclick = () => f.querySelector('#rl').insertAdjacentHTML('beforeend', line()); f.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.closest('.line').remove(); }); },
      onSubmit: async (f) => {
        const lines = $$('#rl .line', f).map(l => ({ stock_item_id: Number(l.querySelector('[data-i]').value), quantity: Number(l.querySelector('[data-q]').value.replace(',', '.')), size_id: l.querySelector('[data-s]')?.value || null })).filter(l => l.quantity > 0);
        await A.api(`/admin/recipes/${kind}/${obj.id}`, { method: 'PUT', body: { lines } }); A.toast('Ficha técnica salva'); A.refresh();
      }
    });
  }

  // ======================================================================
  // FINANCEIRO
  // ======================================================================
  const finState = { from: A.monthStart(), to: A.today(), tab: 'all' };
  A.sections.finance = async (main) => {
    const d = await A.api(`/admin/finance?from=${finState.from}&to=${finState.to}`);
    const s = d.summary;
    const list = d.entries.filter(e => finState.tab === 'all' ? (e.competence_date >= d.from && e.competence_date <= d.to) : finState.tab === 'payable' ? (e.type === 'expense' && e.status === 'open') : finState.tab === 'paid' ? (e.type === 'expense' && e.status === 'paid' && e.competence_date >= d.from) : (e.type === finState.tab && e.competence_date >= d.from && e.competence_date <= d.to));
    const expCats = d.by_category.filter(c => c.type === 'expense');
    main.innerHTML = `<div class="topline"><h1>Financeiro</h1><button class="btn ok" data-new="income">+ Receita</button><button class="btn primary" data-new="expense">+ Despesa / conta a pagar</button></div>
      <div class="filters"><input type="date" data-from value="${d.from}"> até <input type="date" data-to value="${d.to}"> <button class="btn sm" data-go>Aplicar</button></div>
      <div class="grid kpis" style="margin-bottom:10px">
        <div class="kpi hero"><div class="l">Faturamento (vendas)</div><div class="v">${money(s.revenue)}</div><div class="s">pedidos concluídos</div></div>
        <div class="kpi"><div class="l">Total de receitas</div><div class="v">${money(s.income)}</div><div class="s">vendas + outras receitas</div></div>
        <div class="kpi"><div class="l">Recebido no período</div><div class="v">${money(s.received)}</div></div>
        <div class="kpi"><div class="l">Total de despesas</div><div class="v">${money(s.expenses)}</div><div class="s">pagas: ${money(s.paid)}</div></div>
        <div class="kpi"><div class="l">Saldo do período</div><div class="v ${s.balance >= 0 ? 'up' : 'down'}">${money(s.balance)}</div><div class="s">recebido − pago</div></div>
        <div class="kpi hero"><div class="l">Lucro estimado</div><div class="v">${money(s.profit_estimate)}</div><div class="s">faturamento − CMV ${money(s.cmv)} − desp. operacionais ${money(s.expenses_operational)}</div></div>
        <div class="kpi"><div class="l">Contas a pagar</div><div class="v ${s.payable ? 'down' : ''}">${money(s.payable)}</div><div class="s">em aberto (todas as datas)</div></div>
      </div>
      <p class="hint" style="margin-bottom:14px">Faturamento é o que foi vendido; recebimentos são o dinheiro que efetivamente entrou; lucro estimado desconta o custo dos produtos vendidos (fichas técnicas) e as despesas operacionais. Compras de mercadoria entram no custo pelas fichas técnicas, para não contar o mesmo gasto duas vezes.</p>
      <div class="grid g2" style="margin-bottom:14px">
        <div class="card"><h2>Despesas por categoria</h2><div class="chart-box"><canvas id="cExp"></canvas></div></div>
        <div class="card"><h2>Recebimentos por forma de pagamento</h2>${A.table([{ t: 'Forma' }, { t: 'Valor', num: 1 }], d.by_method.map(m => `<tr><td>${esc(m.name)}</td><td class="num">${money(m.v)}</td></tr>`), 'Sem recebimentos.')}</div>
      </div>
      <div class="filters"><div class="seg">${[['all', 'Todos'], ['income', 'Receitas'], ['expense', 'Despesas'], ['payable', 'Contas a pagar'], ['paid', 'Contas pagas']].map(([k, l]) => `<button data-tab="${k}" class="${finState.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="card">${A.table([{ t: 'Data' }, { t: 'Tipo' }, { t: 'Categoria' }, { t: 'Descrição' }, { t: 'Vencimento' }, { t: 'Valor', num: 1 }, { t: 'Situação' }, { t: 'Lançado por' }, { t: '' }],
        list.map(e => `<tr class="${e.status === 'cancelled' ? 'muted' : ''}"><td>${A.br(e.competence_date)}</td><td>${e.type === 'income' ? '<span class="badge b-ok">Receita</span>' : '<span class="badge b-danger">Despesa</span>'}</td>
          <td>${esc(e.category)}</td><td>${esc(e.description)}${e.supplier_name ? ` <span class="hint">· ${esc(e.supplier_name)}</span>` : ''}${e.cancel_reason ? `<br><span class="hint">Cancelado: ${esc(e.cancel_reason)}</span>` : ''}</td>
          <td>${A.br(e.due_date)}${e.status === 'open' && e.due_date && e.due_date < A.today() ? ' <span class="badge b-danger">vencida</span>' : ''}</td><td class="num">${money(e.amount)}</td>
          <td>${{ open: '<span class="badge b-warn">Em aberto</span>', paid: `<span class="badge b-ok">${e.type === 'income' ? 'Recebido' : 'Pago'}</span>`, cancelled: '<span class="badge b-gray">Cancelado</span>' }[e.status]}</td>
          <td>${esc(e.user_name || 'Sistema')}</td>
          <td class="num">${e.status === 'open' ? `<button class="btn sm ok" data-pay="${e.id}">Pagar</button> ` : ''}${e.status !== 'cancelled' && !e.order_id ? `<button class="btn sm danger" data-cancel="${e.id}">Corrigir</button>` : ''}</td></tr>`), 'Nenhum lançamento.')}</div>`;
    A.bar('cExp', expCats.map(c => c.category), [{ label: 'Despesas', data: expCats.map(c => c.v) }], { horizontal: true });
    $('[data-go]', main).onclick = () => { finState.from = $('[data-from]', main).value; finState.to = $('[data-to]', main).value; A.refresh(); };
    $$('[data-tab]', main).forEach(b => b.onclick = () => { finState.tab = b.dataset.tab; A.refresh(); });
    $$('[data-new]', main).forEach(b => b.onclick = () => financeForm(b.dataset.new, d));
    main.onclick = (e) => {
      const p = e.target.closest('[data-pay]'); const c = e.target.closest('[data-cancel]');
      if (p) A.modal({ title: 'Registrar pagamento', submit: 'Confirmar pagamento', body: `<label class="field"><span>Forma de pagamento</span><select name="payment_method"><option value="pix">PIX</option><option value="cash">Dinheiro</option><option value="debit">Débito</option><option value="credit">Crédito</option><option value="boleto">Boleto</option><option value="transfer">Transferência</option></select></label>`,
        onSubmit: async (f) => { await A.api(`/admin/finance/${p.dataset.pay}/pay`, { method: 'POST', body: A.formData(f) }); A.refresh(); } });
      if (c) A.confirm('Corrigir lançamento', 'O lançamento será cancelado (fica no histórico e na auditoria). Depois lance o valor correto.', async (reason) => { await A.api(`/admin/finance/${c.dataset.cancel}/cancel`, { method: 'POST', body: { reason } }); A.refresh(); }, { input: 'Motivo da correção *', danger: true });
    };
  };
  async function financeForm(type, d) {
    const sups = await A.api('/admin/suppliers').catch(() => []);
    A.modal({
      title: type === 'income' ? 'Nova receita' : 'Nova despesa / conta a pagar',
      body: `<div class="row"><label class="field"><span>Categoria *</span><select name="category">${(type === 'income' ? d.income_categories.filter(c => c === 'Outras receitas' || c.startsWith('Vendas')) : d.expense_categories).map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span>Valor (R$) *</span><input name="amount" inputmode="decimal" required></label></div>
        <label class="field"><span>Descrição</span><input name="description"></label>
        <div class="row"><label class="field"><span>Data de competência</span><input type="date" name="competence_date" value="${A.today()}"></label>
        ${type === 'expense' ? `<label class="field"><span>Vencimento</span><input type="date" name="due_date"></label>
        <label class="field"><span>Fornecedor</span><select name="supplier_id"><option value="">—</option>${sups.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>` : ''}</div>
        <label class="check"><input type="checkbox" name="paid" ${type === 'income' ? 'checked' : ''}> ${type === 'income' ? 'Já recebido' : 'Já pago'}</label>
        ${type === 'income' ? '<p class="hint">As vendas do site e do balcão entram automaticamente quando o pedido é concluído. Use aqui só para outras receitas.</p>' : ''}`,
      onSubmit: async (f) => { await A.api('/admin/finance', { method: 'POST', body: { ...A.formData(f), type } }); A.toast('Lançamento salvo'); A.refresh(); }
    });
  }

  // ======================================================================
  // FLUXO DE CAIXA (abertura / fechamento)
  // ======================================================================
  const MOV_T = { sale: 'Venda', extra_in: 'Entrada extra', withdrawal: 'Retirada', sangria: 'Sangria' };
  A.sections.cash = async (main) => {
    const [cur, hist] = await Promise.all([A.api('/admin/cash/current'), A.api('/admin/cash/history')]);
    main.innerHTML = `<div class="topline"><h1>Fluxo de caixa</h1></div><div id="cur"></div>
      <div class="card" style="margin-top:14px"><h2>Histórico de caixas</h2>${A.table([{ t: 'Nº' }, { t: 'Abertura' }, { t: 'Fechamento' }, { t: 'Aberto por' }, { t: 'Fechado por' }, { t: 'Diferença', num: 1 }, { t: '' }],
        hist.map(h => `<tr><td>${h.id}</td><td>${A.br(h.opened_at)}</td><td>${h.closed_at ? A.br(h.closed_at) : '<span class="badge b-ok">aberto</span>'}</td><td>${esc(h.opened_by_name)}</td><td>${esc(h.closed_by_name || '')}</td>
          <td class="num ${h.difference ? 'down' : ''}">${h.difference != null ? money(h.difference) : ''}</td><td class="num">${h.status === 'closed' ? `<button class="btn sm" data-rep="${h.id}">Relatório</button>` : ''}</td></tr>`), 'Nenhum caixa registrado.')}</div>`;
    const box = $('#cur', main);
    if (!cur) {
      box.innerHTML = `<form class="card" style="max-width:480px"><h2>Abrir caixa</h2><label class="field"><span>Valor inicial em dinheiro (troco)</span><input name="opening_amount" inputmode="decimal" placeholder="0,00"></label>
        <label class="field"><span>Observação</span><input name="notes"></label><button class="btn primary">Abrir caixa</button></form>`;
      $('form', box).onsubmit = async (e) => { e.preventDefault(); try { await A.api('/admin/cash/open', { method: 'POST', body: A.formData(e.target) }); A.toast('Caixa aberto'); A.refresh(); } catch (ex) { A.toast(ex.message); } };
    } else {
      const ex = cur.live_expected;
      box.innerHTML = `<div class="grid kpis" style="margin-bottom:14px">
          <div class="kpi hero"><div class="l">Caixa aberto</div><div class="v" style="font-size:1.1rem">${A.br(cur.opened_at)}</div><div class="s">por ${esc(cur.opened_by_name)} · inicial ${money(cur.opening_amount)}</div></div>
          <div class="kpi"><div class="l">Dinheiro esperado</div><div class="v">${money(ex.cash)}</div></div>
          <div class="kpi"><div class="l">PIX</div><div class="v">${money(ex.pix)}</div></div>
          <div class="kpi"><div class="l">Crédito</div><div class="v">${money(ex.credit)}</div></div>
          <div class="kpi"><div class="l">Débito</div><div class="v">${money(ex.debit)}</div></div>
          <div class="kpi"><div class="l">Vendas</div><div class="v">${money(cur.totals.sales)}</div><div class="s">sangrias ${money(cur.totals.sangria)} · retiradas ${money(cur.totals.withdrawal)}</div></div></div>
        <div class="grid g2">
          <div class="card"><h2>Movimentações do caixa</h2><div class="filters"><button class="btn sm ok" data-m="extra_in">+ Entrada extra</button><button class="btn sm" data-m="withdrawal">− Retirada</button><button class="btn sm" data-m="sangria">− Sangria</button></div>
            ${A.table([{ t: 'Hora' }, { t: 'Tipo' }, { t: 'Forma' }, { t: 'Descrição' }, { t: 'Valor', num: 1 }], cur.movements.map(m => `<tr><td>${m.created_at.slice(11, 16)}</td><td>${MOV_T[m.type]}</td><td>${A.PAY[m.method] || m.method}</td><td>${esc(m.description)}</td><td class="num ${['withdrawal', 'sangria'].includes(m.type) ? 'down' : ''}">${['withdrawal', 'sangria'].includes(m.type) ? '−' : ''}${money(m.amount)}</td></tr>`), 'As vendas concluídas entram aqui automaticamente.')}</div>
          <form class="card" id="closeF"><h2>Fechar caixa</h2><p class="hint">Conte os valores e informe o total de cada forma de pagamento.</p>
            ${['cash', 'pix', 'credit', 'debit'].map(k => `<label class="field"><span>${A.PAY[k]} contado <span class="hint">(esperado ${money(ex[k])})</span></span><input name="${k}" inputmode="decimal" value="${A.toReais(ex[k])}"></label>`).join('')}
            <label class="field"><span>Observação</span><input name="notes"></label><div id="diff" class="alert info">Diferença: R$ 0,00</div><button class="btn primary" style="margin-top:10px">Fechar caixa</button></form></div>`;
      const cf = $('#closeF', box);
      const calcDiff = () => { let t = 0; for (const k of ['cash', 'pix', 'credit', 'debit']) t += Math.round(Number(String(cf.elements[k].value).replace(',', '.') || 0) * 100) - ex[k]; const el = $('#diff', box); el.className = 'alert ' + (t === 0 ? 'ok' : 'warning'); el.textContent = `Diferença: ${money(t)} ${t > 0 ? '(sobra)' : t < 0 ? '(falta)' : ''}`; };
      cf.oninput = calcDiff; calcDiff();
      cf.onsubmit = (e) => {
        e.preventDefault();
        A.confirm('Fechar caixa', 'Confirmar o fechamento? Depois de fechado o caixa não pode ser reaberto.', async () => {
          const f = A.formData(cf); const r = await A.api('/admin/cash/close', { method: 'POST', body: { counted: { cash: f.cash, pix: f.pix, credit: f.credit, debit: f.debit }, notes: f.notes } });
          A.refresh(); cashReport(r);
        });
      };
      $$('[data-m]', box).forEach(b => b.onclick = () => A.modal({
        title: MOV_T[b.dataset.m], submit: 'Registrar',
        body: `<div class="row"><label class="field"><span>Valor *</span><input name="amount" inputmode="decimal" required></label>
          <label class="field"><span>Forma</span><select name="method">${Object.entries(A.PAY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
          <label class="field"><span>Descrição *</span><input name="description" placeholder="${b.dataset.m === 'sangria' ? 'Ex.: retirada para o cofre' : 'Ex.: troco extra, pagamento de entregador'}" required></label>`,
        onSubmit: async (f) => { await A.api('/admin/cash/movement', { method: 'POST', body: { ...A.formData(f), type: b.dataset.m } }); A.refresh(); }
      }));
    }
    main.onclick = async (e) => { const r = e.target.closest('[data-rep]'); if (r) cashReport(await A.api('/admin/cash/' + r.dataset.rep)); };
  };
  function cashReport(c) {
    const keys = ['cash', 'pix', 'credit', 'debit'];
    A.modal({
      title: `Fechamento do caixa nº ${c.id}`, wide: true,
      body: `<p>Abertura: ${A.br(c.opened_at)} por ${esc(c.opened_by_name)} · Fechamento: ${A.br(c.closed_at)} por ${esc(c.closed_by_name || '')}</p>
        ${A.table([{ t: 'Forma' }, { t: 'Esperado', num: 1 }, { t: 'Contado', num: 1 }, { t: 'Diferença', num: 1 }], keys.map(k => { const diff = (c.counted?.[k] || 0) - (c.expected?.[k] || 0); return `<tr><td>${A.PAY[k]}</td><td class="num">${money(c.expected?.[k])}</td><td class="num">${money(c.counted?.[k])}</td><td class="num ${diff ? 'down' : ''}">${money(diff)}</td></tr>`; }))}
        <p><strong>Diferença total: ${money(c.difference)}</strong> · Vendas: ${money(c.totals.sales)} · Entradas extras: ${money(c.totals.extra_in)} · Retiradas: ${money(c.totals.withdrawal)} · Sangrias: ${money(c.totals.sangria)}</p>
        ${c.notes ? `<p>Obs.: ${esc(c.notes)}</p>` : ''}
        <h3>Movimentações</h3>${A.table([{ t: 'Hora' }, { t: 'Tipo' }, { t: 'Forma' }, { t: 'Descrição' }, { t: 'Valor', num: 1 }, { t: 'Usuário' }], c.movements.map(m => `<tr><td>${m.created_at.slice(11, 16)}</td><td>${MOV_T[m.type]}</td><td>${A.PAY[m.method] || ''}</td><td>${esc(m.description)}</td><td class="num">${money(m.amount)}</td><td>${esc(m.user_name || '')}</td></tr>`))}`,
      extraButtons: '<button type="button" class="btn" data-print>Imprimir</button>',
      onOpen: (f) => { f.querySelector('[data-print]').onclick = () => { const w = window.open('', '_blank'); w.document.write(`<html><head><title>Caixa ${c.id}</title><style>body{font:13px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px}</style></head><body><h2>SUPREMO AÇAÍ — Fechamento de caixa nº ${c.id}</h2>${f.querySelector('.body').innerHTML}</body></html>`); w.document.close(); w.print(); }; }
    });
  }

  // ======================================================================
  // FORNECEDORES E COMPRAS
  // ======================================================================
  let supTab = 'suppliers';
  A.sections.suppliers = async (main) => {
    const [sups, purchases, items] = await Promise.all([A.api('/admin/suppliers'), A.api('/admin/purchases'), A.api('/admin/stock')]);
    main.innerHTML = `<div class="topline"><h1>Fornecedores e compras</h1>${A.can('suppliers') ? '<button class="btn" data-newsup>+ Fornecedor</button>' : ''}${A.can('purchases') ? '<button class="btn primary" data-newpur>+ Registrar compra</button>' : ''}</div>
      <div class="filters"><div class="seg"><button data-tab="suppliers" class="${supTab === 'suppliers' ? 'on' : ''}">Fornecedores</button><button data-tab="purchases" class="${supTab === 'purchases' ? 'on' : ''}">Compras</button></div></div>
      <div class="card" id="supBody"></div>`;
    const body = $('#supBody', main);
    if (supTab === 'suppliers') {
      body.innerHTML = A.table([{ t: 'Fornecedor' }, { t: 'Contato' }, { t: 'Produtos fornecidos' }, { t: 'Compras', num: 1 }, { t: 'Valores pagos', num: 1 }, { t: 'Pendências', num: 1 }, { t: '' }],
        sups.map(s => `<tr class="${s.active ? '' : 'muted'}"><td><strong>${esc(s.name)}</strong></td><td>${esc(s.phone)}${s.whatsapp ? `<br><a target="_blank" rel="noopener" href="https://wa.me/55${s.whatsapp.replace(/^55/, '')}">WhatsApp</a>` : ''}</td>
          <td>${esc(s.products)}</td><td class="num">${s.purchases_count}</td><td class="num">${money(s.paid_total)}</td><td class="num ${s.pending_total ? 'down' : ''}">${money(s.pending_total)}</td>
          <td class="num"><button class="btn sm" data-hist="${s.id}">Histórico</button> ${A.can('suppliers') ? `<button class="btn sm" data-edit="${s.id}">Editar</button>` : ''}</td></tr>`), 'Nenhum fornecedor cadastrado.');
    } else {
      body.innerHTML = purchasesTable(purchases);
    }
    $$('[data-tab]', main).forEach(b => b.onclick = () => { supTab = b.dataset.tab; A.refresh(); });
    $('[data-newsup]', main) && ($('[data-newsup]', main).onclick = () => supplierForm(null));
    $('[data-newpur]', main) && ($('[data-newpur]', main).onclick = () => purchaseForm(sups, items));
    main.onclick = (e) => {
      const ed = e.target.closest('[data-edit]'); const h = e.target.closest('[data-hist]'); const rc = e.target.closest('[data-receive]'); const cn = e.target.closest('[data-pcancel]');
      if (ed) supplierForm(sups.find(s => s.id === Number(ed.dataset.edit)));
      if (h) { const s = sups.find(x => x.id === Number(h.dataset.hist)); A.modal({ title: `Histórico — ${s.name}`, wide: true, body: purchasesTable(purchases.filter(p => p.supplier_id === s.id)) }); }
      if (rc) A.modal({ title: 'Confirmar recebimento', submit: 'Confirmar recebimento',
        body: `<p>Ao confirmar, os itens entram no estoque e é gerada a conta a pagar da compra nº ${rc.dataset.receive}.</p>${A.can('finance') ? '<label class="check"><input type="checkbox" name="paid_now"> Já foi paga</label>' : ''}`,
        onSubmit: async (f) => { await A.api(`/admin/purchases/${rc.dataset.receive}/receive`, { method: 'POST', body: A.formData(f) }); A.toast('Mercadoria recebida e estoque atualizado'); A.refresh(); } });
      if (cn) A.confirm('Cancelar compra', 'Cancelar esta compra (ainda não recebida)?', async (reason) => { await A.api(`/admin/purchases/${cn.dataset.pcancel}/cancel`, { method: 'POST', body: { reason } }); A.refresh(); }, { input: 'Motivo', danger: true });
    };
  };
  function purchasesTable(list) {
    const st = { pending: '<span class="badge b-warn">Aguardando entrega</span>', received: '<span class="badge b-ok">Recebida</span>', cancelled: '<span class="badge b-gray">Cancelada</span>' };
    return A.table([{ t: 'Nº' }, { t: 'Data' }, { t: 'Fornecedor' }, { t: 'Itens' }, { t: 'Total', num: 1 }, { t: 'Vencimento' }, { t: 'Situação' }, { t: 'Pagamento' }, { t: '' }],
      list.map(p => `<tr><td>${p.id}</td><td>${A.br(p.created_at)}</td><td>${esc(p.supplier_name || '—')}</td><td>${p.items.map(i => `${A.qty(i.quantity)} ${esc(i.unit)} ${esc(i.item_name)}`).join('<br>')}</td>
        <td class="num">${money(p.total)}</td><td>${A.br(p.due_date)}</td><td>${st[p.status]}</td><td>${p.finance_status === 'paid' ? '<span class="badge b-ok">Pago</span>' : p.finance_status === 'open' ? '<span class="badge b-warn">Em aberto</span>' : '—'}</td>
        <td class="num">${p.status === 'pending' ? `<button class="btn sm ok" data-receive="${p.id}">Receber</button> <button class="btn sm danger" data-pcancel="${p.id}">Cancelar</button>` : ''}</td></tr>`), 'Nenhuma compra registrada.');
  }
  function supplierForm(s) {
    A.modal({
      title: s ? 'Editar fornecedor' : 'Novo fornecedor',
      body: `<label class="field"><span>Nome da empresa *</span><input name="name" value="${esc(s?.name)}" required></label>
        <div class="row"><label class="field"><span>Telefone</span><input name="phone" value="${esc(s?.phone)}"></label><label class="field"><span>WhatsApp</span><input name="whatsapp" value="${esc(s?.whatsapp)}"></label></div>
        <label class="field"><span>Produtos fornecidos</span><textarea name="products" rows="2">${esc(s?.products)}</textarea></label>
        <label class="field"><span>Observações</span><textarea name="notes" rows="2">${esc(s?.notes)}</textarea></label>
        <label class="check"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}> Ativo</label>`,
      onSubmit: async (f) => { await A.api('/admin/suppliers' + (s ? '/' + s.id : ''), { method: s ? 'PUT' : 'POST', body: A.formData(f) }); A.refresh(); }
    });
  }
  function purchaseForm(sups, items) {
    if (!items.length) return A.toast('Cadastre os itens de estoque primeiro.');
    const line = () => `<div class="line l4"><select data-i>${items.filter(i => i.active).map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select>
      <input data-q inputmode="decimal" placeholder="Quantidade"><input data-c inputmode="decimal" placeholder="Custo por unidade (R$)"><button type="button" class="btn sm danger" data-rm>×</button></div>`;
    A.modal({
      title: 'Registrar compra', wide: true, submit: 'Salvar compra',
      body: `<div class="row"><label class="field"><span>Fornecedor</span><select name="supplier_id"><option value="">—</option>${sups.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Vencimento do pagamento</span><input type="date" name="due_date"></label><label class="field"><span>Nota fiscal / referência</span><input name="invoice"></label></div>
        <h3>Itens</h3><p class="hint">Quantidade e custo na unidade de medida do item (ex.: 5000 ml a R$ 0,02 = R$ 100,00).</p>
        <div class="lines" id="pl">${line()}</div><button type="button" class="btn sm" data-add>+ Item</button> <strong id="ptotal" style="margin-left:12px"></strong>
        <label class="field" style="margin-top:12px"><span>Observações</span><input name="notes"></label>
        <label class="check"><input type="checkbox" name="receive_now"> Mercadoria já recebida (dar entrada no estoque agora)</label>
        ${A.can('finance') ? '<label class="check"><input type="checkbox" name="paid_now"> Já paga</label>' : ''}`,
      onOpen: (f) => {
        const tot = () => { let t = 0; $$('#pl .line', f).forEach(l => t += Number(l.querySelector('[data-q]').value.replace(',', '.') || 0) * Number(l.querySelector('[data-c]').value.replace(',', '.') || 0)); $('#ptotal', f).textContent = 'Total: ' + money(Math.round(t * 100)); };
        f.querySelector('[data-add]').onclick = () => f.querySelector('#pl').insertAdjacentHTML('beforeend', line());
        f.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) { e.target.closest('.line').remove(); tot(); } });
        f.addEventListener('input', tot);
      },
      onSubmit: async (f) => {
        const d = A.formData(f);
        d.items = $$('#pl .line', f).map(l => ({ stock_item_id: Number(l.querySelector('[data-i]').value), quantity: Number(l.querySelector('[data-q]').value.replace(',', '.')), unit_cost: l.querySelector('[data-c]').value })).filter(i => i.quantity > 0);
        await A.api('/admin/purchases', { method: 'POST', body: d }); A.toast('Compra registrada'); supTab = 'purchases'; A.refresh();
      }
    });
  }

  // ======================================================================
  // FUNCIONÁRIOS E PERMISSÕES
  // ======================================================================
  const PERM_LABEL = { dashboard: 'Dashboard', orders: 'Pedidos', products: 'Produtos', stock: 'Estoque', movements: 'Movimentações', recipes: 'Fichas técnicas', suppliers: 'Fornecedores', purchases: 'Compras', cash: 'Caixa', 'reports.operational': 'Relatórios operacionais', '*': 'Acesso completo' };
  A.sections.employees = async (main) => {
    const d = await A.api('/admin/users');
    main.innerHTML = `<div class="topline"><h1>Funcionários e permissões</h1><button class="btn primary" data-new>+ Usuário</button></div>
      <div class="card" style="margin-bottom:14px">${A.table([{ t: 'Nome' }, { t: 'Usuário' }, { t: 'Perfil' }, { t: 'Telefone' }, { t: 'Situação' }, { t: '' }],
        d.users.map(u => `<tr class="${u.active ? '' : 'muted'}"><td><strong>${esc(u.name)}</strong></td><td>${esc(u.username)}</td><td>${esc(d.roles[u.role])}</td><td>${esc(u.phone || '')}</td>
          <td><span class="badge ${u.active ? 'b-ok' : 'b-gray'}">${u.active ? 'Ativo' : 'Desativado'}</span></td><td class="num"><button class="btn sm" data-edit="${u.id}">Editar</button></td></tr>`))}</div>
      <div class="card"><h2>O que cada perfil acessa</h2>${A.table([{ t: 'Perfil' }, { t: 'Acesso' }], Object.entries(d.roles).map(([k, v]) => `<tr><td><strong>${esc(v)}</strong></td><td>${d.permissions[k].map(p => `<span class="pill-perm">${PERM_LABEL[p] || p}</span>`).join('')}</td></tr>`))}
      <p class="hint">Todas as operações importantes ficam registradas com o nome de quem realizou (Configurações › Auditoria). Usuários não são apagados, apenas desativados, para preservar o histórico.</p></div>`;
    const form = (u) => A.modal({
      title: u ? 'Editar usuário' : 'Novo usuário',
      body: `<div class="row"><label class="field"><span>Nome *</span><input name="name" value="${esc(u?.name)}" required></label>
        <label class="field"><span>Usuário (login) *</span><input name="username" value="${esc(u?.username)}" ${u ? 'disabled' : 'required'}></label></div>
        <div class="row"><label class="field"><span>Perfil *</span><select name="role">${Object.entries(d.roles).map(([k, v]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Telefone</span><input name="phone" value="${esc(u?.phone)}"></label></div>
        <label class="field"><span>${u ? 'Nova senha (deixe em branco para manter)' : 'Senha *'}</span><input name="password" type="password" autocomplete="new-password"></label>
        <p class="hint">Mínimo de 8 caracteres, com letras e números.</p>
        ${u ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Ativo (desmarque para bloquear o acesso)</label>` : ''}`,
      onSubmit: async (f) => {
        const b = A.formData(f); if (u && !b.password) delete b.password; if (!u) b.active = true;
        await A.api('/admin/users' + (u ? '/' + u.id : ''), { method: u ? 'PUT' : 'POST', body: b }); A.toast('Usuário salvo'); A.refresh();
      }
    });
    $('[data-new]', main).onclick = () => form(null);
    main.onclick = (e) => { const ed = e.target.closest('[data-edit]'); if (ed) form(d.users.find(u => u.id === Number(ed.dataset.edit))); };
  };

  // ======================================================================
  // RELATÓRIOS
  // ======================================================================
  const repState = { type: '', from: A.monthStart(), to: A.today() };
  A.sections.reports = async (main) => {
    const list = await A.api('/admin/reports');
    if (!repState.type || !list.find(r => r.id === repState.type)) repState.type = list[0]?.id;
    main.innerHTML = `<div class="topline"><h1>Relatórios gerenciais</h1></div>
      <div class="filters"><select data-type>${list.map(r => `<option value="${r.id}" ${r.id === repState.type ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>
      <input type="date" data-from value="${repState.from}"> até <input type="date" data-to value="${repState.to}"><button class="btn sm primary" data-go>Gerar</button>
      <button class="btn sm" data-x="pdf">Exportar PDF</button><button class="btn sm" data-x="xlsx">Exportar Excel</button></div>
      <div class="card" id="rep"><div class="empty">Carregando…</div></div>`;
    const read = () => { repState.type = $('[data-type]', main).value; repState.from = $('[data-from]', main).value; repState.to = $('[data-to]', main).value; };
    const url = (fmt) => `/api/admin/reports/${repState.type}?from=${repState.from}&to=${repState.to}${fmt ? '&format=' + fmt : ''}`;
    const show = async () => {
      read();
      const r = await A.api(url().replace('/api', ''));
      const cell = (v) => v && typeof v === 'object' && 'money' in v ? money(v.money) : esc(v ?? '');
      const isNum = (i) => r.rows.some(row => row[i] && typeof row[i] === 'object') || r.rows.every(row => typeof row[i] === 'number');
      $('#rep', main).innerHTML = `<h2>${esc(r.title)} <span class="hint">${A.br(r.from)} a ${A.br(r.to)}</span></h2>
        ${A.table(r.columns.map((t, i) => ({ t, num: isNum(i) })), r.rows.map(row => `<tr>${row.map((v, i) => `<td class="${isNum(i) ? 'num' : ''}">${cell(v)}</td>`).join('')}</tr>`).concat(r.totals ? [`<tr style="font-weight:800">${r.totals.map((v, i) => `<td class="${isNum(i) ? 'num' : ''}">${cell(v)}</td>`).join('')}</tr>`] : []), 'Nenhum registro no período.')}
        ${r.note ? `<p class="hint">${esc(r.note)}</p>` : ''}`;
    };
    $('[data-go]', main).onclick = show;
    $$('[data-x]', main).forEach(b => b.onclick = () => { read(); location.href = url(b.dataset.x); });
    show().catch(e => { $('#rep', main).innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; });
  };

  // ======================================================================
  // CONFIGURAÇÕES
  // ======================================================================
  let setTab = 'store';
  A.sections.settings = async (main) => {
    const s = await A.api('/admin/settings');
    const tabs = [['store', 'Loja e delivery'], ['payments', 'Pagamentos'], ['brand', 'Identidade visual'], ['alerts', 'Alertas'], ['security', 'Segurança e backup'], ['audit', 'Auditoria']];
    main.innerHTML = `<div class="topline"><h1>Configurações</h1></div>
      <div class="filters"><div class="seg">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${setTab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div><div id="setBody"></div>`;
    $$('[data-tab]', main).forEach(b => b.onclick = () => { setTab = b.dataset.tab; A.refresh(); });
    const body = $('#setBody', main);
    const save = async (patch, msg = 'Configurações salvas') => { await A.api('/admin/settings', { method: 'PUT', body: patch }); A.toast(msg); A.config = await (await fetch('/api/public/config')).json(); A.refresh(); };
    const bindForm = (f, fn) => { f.onsubmit = async (e) => { e.preventDefault(); try { await fn(A.formData(f), f); } catch (ex) { A.toast(ex.message); } }; };

    if (setTab === 'store') {
      body.innerHTML = `<form class="card" style="max-width:760px">
        <h2>Dados da empresa</h2>
        <label class="field"><span>Nome</span><input name="store_name" value="${esc(s.store_name)}"></label>
        <label class="field"><span>Slogan</span><input name="slogan" value="${esc(s.slogan)}"></label>
        <label class="field"><span>Endereço</span><input name="address" value="${esc(s.address)}"></label>
        <div class="row"><label class="field"><span>WhatsApp (com DDD)</span><input name="whatsapp" value="${esc(s.whatsapp)}"></label><label class="field"><span>WhatsApp (como exibir)</span><input name="whatsapp_display" value="${esc(s.whatsapp_display)}"></label></div>
        <label class="field"><span>Atendimento</span><input name="service_info" value="${esc(s.service_info)}"></label>
        <label class="field"><span>Horário de funcionamento</span><input name="opening_hours" value="${esc(s.opening_hours)}" placeholder="Ex.: Ter a Dom, 14h às 23h"></label>
        <div class="row"><label class="field"><span>Abre às (pedidos online)</span><input type="time" name="open_time" value="${esc(s.open_time || '')}"></label>
        <label class="field"><span>Fecha às</span><input type="time" name="close_time" value="${esc(s.close_time || '')}"></label></div>
        <p class="hint">Fora desse horário o site não aceita pedidos (o cliente pode montar o carrinho e enviar quando abrir).</p>
        <h2 style="margin-top:18px">Delivery e pedidos</h2>
        <div class="row"><label class="field"><span>Taxa de entrega (R$)</span><input name="delivery_fee" inputmode="decimal" value="${A.toReais(s.delivery_fee)}"></label>
        <label class="field"><span>Pedido mínimo (R$, 0 = sem mínimo)</span><input name="min_order" inputmode="decimal" value="${A.toReais(s.min_order)}"></label></div>
        <label class="check"><input type="checkbox" name="store_open" ${s.store_open ? 'checked' : ''}> Loja aberta para pedidos online</label>
        <label class="check"><input type="checkbox" name="delivery_enabled" ${s.delivery_enabled ? 'checked' : ''}> Delivery disponível</label>
        <label class="check"><input type="checkbox" name="pickup_enabled" ${s.pickup_enabled ? 'checked' : ''}> Retirada na loja disponível</label>
        <button class="btn primary">Salvar</button></form>`;
      bindForm($('form', body), (d) => save(d));
    } else if (setTab === 'payments') {
      const p = s.payments; const px = p.pix || {};
      body.innerHTML = `<form class="card" style="max-width:760px">
        <h2>Formas de pagamento aceitas</h2>
        ${['pix', 'cash', 'credit', 'debit'].map(k => `<label class="check"><input type="checkbox" name="en_${k}" ${p[k]?.enabled !== false ? 'checked' : ''}> ${{ pix: 'PIX', cash: 'Dinheiro', credit: 'Cartão de crédito', debit: 'Cartão de débito' }[k]}</label>`).join('')}
        <label class="check"><input type="checkbox" name="pix_on_site" ${px.on_site !== false ? 'checked' : ''}> PIX pago no local (na entrega ou retirada), sem QR Code no site</label>
        <h2 style="margin-top:18px">Dados do PIX da empresa</h2>
        <div class="row"><label class="field"><span>Tipo de chave</span><select name="key_type">${[['phone', 'Telefone'], ['cnpj', 'CNPJ'], ['cpf', 'CPF'], ['email', 'E-mail'], ['random', 'Chave aleatória']].map(([k, v]) => `<option value="${k}" ${px.key_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Chave PIX</span><input name="key" value="${esc(px.key)}"></label></div>
        <div class="row"><label class="field"><span>Nome do recebedor (como no banco)</span><input name="receiver_name" value="${esc(px.receiver_name)}" maxlength="25"></label>
        <label class="field"><span>Cidade do recebedor</span><input name="receiver_city" value="${esc(px.receiver_city)}" maxlength="15"></label></div>
        <label class="field"><span>Instruções para o cliente</span><input name="instructions" value="${esc(px.instructions)}" placeholder="Ex.: envie o comprovante pelo WhatsApp"></label>
        <p class="hint">Com a chave cadastrada, o cliente recebe automaticamente o QR Code e o "PIX copia e cola" com o valor exato do pedido. Sem integração com o banco, o pagamento só aparece como confirmado depois que alguém da equipe conferir o recebimento e clicar em "Confirmar PIX".</p>
        <h2 style="margin-top:18px">Pagamento online (Mercado Pago)</h2>
        <div class="alert ${s.online_payment_configured ? 'ok' : 'info'}">${s.online_payment_configured ? 'Integração ativa: PIX com confirmação automática e cartão online pelo checkout seguro do Mercado Pago.' : 'Não configurado. Para ativar, o responsável técnico define as credenciais do Mercado Pago no servidor (veja o arquivo LEIA-ME). As credenciais nunca ficam no navegador.'}</div>
        <h2 style="margin-top:18px">Taxas de cartão (para o cálculo do lucro)</h2>
        <div class="row"><label class="field"><span>Crédito (%)</span><input name="fee_credit" inputmode="decimal" value="${s.card_fee_percent?.credit || 0}"></label><label class="field"><span>Débito (%)</span><input name="fee_debit" inputmode="decimal" value="${s.card_fee_percent?.debit || 0}"></label></div>
        <button class="btn primary">Salvar</button></form>`;
      bindForm($('form', body), (d) => save({
        payments: { ...p, pix: { enabled: d.en_pix, on_site: d.pix_on_site, key: d.key, key_type: d.key_type, receiver_name: d.receiver_name, receiver_city: d.receiver_city, instructions: d.instructions }, cash: { enabled: d.en_cash }, credit: { enabled: d.en_credit }, debit: { enabled: d.en_debit } },
        card_fee_percent: { credit: Number(String(d.fee_credit).replace(',', '.')) || 0, debit: Number(String(d.fee_debit).replace(',', '.')) || 0 }
      }));
    } else if (setTab === 'brand') {
      const c = s.brand_colors || {};
      body.innerHTML = `<form class="card" style="max-width:760px">
        <h2>Logo oficial</h2>${A.imageField('logo', s.logo, 'Logo (PNG com fundo transparente, de preferência)')}
        <h2 style="margin-top:18px">Cores oficiais da marca</h2>
        <p class="hint">${s.brand_colors ? 'Cores oficiais aplicadas.' : 'O site está com cores provisórias. Cadastre aqui as cores oficiais (código #RRGGBB) para aplicá-las em todo o site.'}</p>
        <div class="row">${[['primary', 'Cor principal', '#13a49c'], ['dark', 'Cor escura (topo/rodapé)', '#0b5e59'], ['accent', 'Cor de destaque (botões)', '#e38340'], ['accent_text', 'Texto sobre o destaque', '#2b1606'], ['background', 'Fundo da página', '#f7f1e6']].map(([k, l, def]) => `<label class="field"><span>${l}</span><input type="color" name="c_${k}" value="${c[k] || def}"></label>`).join('')}</div>
        <label class="check"><input type="checkbox" name="use_colors" ${s.brand_colors ? 'checked' : ''}> Aplicar estas cores no site</label>
        <h2 style="margin-top:18px">Fotos do banner da página inicial</h2>
        <p class="hint">Use as fotos reais de açaí e petiscos. Recomendado: imagens quadradas ou 4:3, com pelo menos 1200 px.</p>
        <div id="heroList" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">${(s.hero_images || []).map((u, i) => `<div style="position:relative"><img src="${esc(u)}" class="thumb" style="width:120px;height:90px"><button type="button" class="btn sm danger" data-rmhero="${i}" style="position:absolute;top:4px;right:4px">×</button></div>`).join('')}</div>
        <input type="file" accept="image/jpeg,image/png,image/webp" data-hero data-skip>
        <div style="margin-top:16px"><button class="btn primary">Salvar identidade visual</button> <a class="btn" href="/" target="_blank">Ver site ↗</a></div></form>`;
      const f = $('form', body); A.bindImages(f);
      let hero = [...(s.hero_images || [])];
      f.querySelector('[data-hero]').onchange = async (e) => { try { hero.push(await A.upload(e.target.files[0])); await save({ hero_images: hero }, 'Foto adicionada ao banner'); } catch (ex) { A.toast(ex.message); } };
      f.addEventListener('click', async (e) => { const b = e.target.closest('[data-rmhero]'); if (b) { hero.splice(Number(b.dataset.rmhero), 1); await save({ hero_images: hero }, 'Foto removida'); } });
      bindForm(f, (d) => save({ logo: d.logo || null, brand_colors: d.use_colors ? { primary: d.c_primary, dark: d.c_dark, accent: d.c_accent, accent_text: d.c_accent_text, background: d.c_background } : null }));
    } else if (setTab === 'alerts') {
      body.innerHTML = `<form class="card" style="max-width:600px"><h2>Alertas</h2>
        <label class="field"><span>Avisar produtos que vencem em até (dias)</span><input type="number" min="1" name="expiry_alert_days" value="${s.expiry_alert_days}"></label>
        <label class="field"><span>Avisar contas que vencem em até (dias)</span><input type="number" min="0" name="bills_alert_days" value="${s.bills_alert_days}"></label>
        <p class="hint">Estoque baixo usa o "estoque mínimo" de cada item. Despesas acima da média comparam o mês atual com a média dos 3 meses anteriores.</p>
        <button class="btn primary">Salvar</button></form>`;
      bindForm($('form', body), (d) => save({ expiry_alert_days: Number(d.expiry_alert_days), bills_alert_days: Number(d.bills_alert_days) }));
    } else if (setTab === 'security') {
      body.innerHTML = `<div class="grid g2"><form class="card"><h2>Alterar minha senha</h2>
          <label class="field"><span>Senha atual</span><input type="password" name="current" autocomplete="current-password"></label>
          <label class="field"><span>Nova senha</span><input type="password" name="next" autocomplete="new-password"></label><button class="btn primary">Alterar senha</button></form>
        <div class="card"><h2>Cópias de segurança</h2><p class="hint">O banco de dados na nuvem (Turso) guarda o histórico automaticamente e permite restaurar uma data anterior. Além disso, baixe uma cópia completa de vez em quando e guarde no seu computador ou Google Drive.</p>
          <a class="btn primary" href="/api/admin/backup.json">Baixar cópia completa dos dados</a></div></div>`;
      bindForm($('form', body), async (d) => { await A.api('/auth/password', { method: 'POST', body: d }); A.toast('Senha alterada'); A.refresh(); });
    } else {
      const log = await A.api('/admin/audit?limit=500');
      body.innerHTML = `<div class="card"><h2>Auditoria</h2><p class="hint">Registro permanente (somente leitura) de quem fez cada operação importante.</p>
        ${A.table([{ t: 'Data/hora' }, { t: 'Usuário' }, { t: 'Ação' }, { t: 'Registro' }, { t: 'Detalhes' }], log.map(l => `<tr><td>${A.br(l.created_at)}</td><td>${esc(l.user_name)}</td><td>${esc(l.action)}</td><td>${esc(l.entity)}${l.entity_id ? ' #' + l.entity_id : ''}</td><td><code style="font-size:.75rem;word-break:break-all">${esc((l.details || '').slice(0, 220))}</code></td></tr>`))}</div>`;
    }
  };
})();
