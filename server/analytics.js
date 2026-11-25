// Indicadores, gráficos, alertas e relatórios gerenciais — sempre calculados a partir dos registros reais.
const { db, getSetting } = require('./db');
const { PAYMENT_LABELS, MODE_LABELS, today } = require('./orders');

const DONE = "o.status = 'delivered'";
const OPEN_STATUSES = "('received','confirmed','preparing','out_for_delivery')";
// Compras de mercadoria viram estoque (custo entra pelo CMV das fichas técnicas), por isso não
// entram como despesa operacional no lucro estimado — evita contar o mesmo custo duas vezes.
const STOCK_EXPENSE_CATEGORIES = ['Compra de mercadorias', 'Pagamento de fornecedores', 'Embalagens'];

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }

function resolvePeriod(q) {
  const t = today();
  let from = t, to = t;
  switch (q.period) {
    case 'week': from = addDays(t, -6); break;
    case 'month': from = t.slice(0, 8) + '01'; break;
    case 'custom':
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) from = q.from;
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) to = q.to;
      if (from > to) [from, to] = [to, from];
      break;
    default: break; // today
  }
  return { from, to };
}

async function itemCost(productId, sizeId, addons) {
  let c = 0;
  const rows = await db.prepare(`SELECT r.quantity, s.unit_cost FROM recipes r JOIN stock_items s ON s.id = r.stock_item_id
    WHERE r.product_id = ? AND (r.size_id IS NULL OR r.size_id = ?)`).all(productId, sizeId || -1);
  for (const r of rows) c += r.quantity * r.unit_cost;
  for (const a of addons || []) {
    for (const r of await db.prepare(`SELECT r.quantity, s.unit_cost FROM recipes r JOIN stock_items s ON s.id = r.stock_item_id WHERE r.addon_id = ?`).all(a.id)) {
      c += r.quantity * r.unit_cost;
    }
  }
  return Math.round(c);
}

async function sumRevenue(from, to) {
  return await db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue, COALESCE(SUM(cost_estimate),0) cmv,
    COALESCE(SUM(delivery_fee),0) fees FROM orders o WHERE ${DONE} AND date(completed_at) BETWEEN ? AND ?`).get(from, to);
}
async function sumExpenses(from, to) {
  const all = await db.prepare(`SELECT category, COALESCE(SUM(amount),0) total FROM finance_entries
    WHERE type='expense' AND status != 'cancelled' AND competence_date BETWEEN ? AND ? GROUP BY category`).all(from, to);
  const total = all.reduce((s, r) => s + r.total, 0);
  const operational = all.filter(r => !STOCK_EXPENSE_CATEGORIES.includes(r.category)).reduce((s, r) => s + r.total, 0);
  return { total, operational, byCategory: all };
}
async function otherIncome(from, to) {
  return (await db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM finance_entries WHERE type='income' AND order_id IS NULL
    AND status != 'cancelled' AND competence_date BETWEEN ? AND ?`).get(from, to)).v;
}

async function kpis(from, to) {
  const rev = await sumRevenue(from, to);
  const exp = await sumExpenses(from, to);
  const other = await otherIncome(from, to);
  const received = (await db.prepare(`SELECT COUNT(*) n FROM orders WHERE date(created_at) BETWEEN ? AND ?`).get(from, to)).n;
  const inProgress = (await db.prepare(`SELECT COUNT(*) n FROM orders WHERE status IN ${OPEN_STATUSES}`).get()).n;
  const pending = (await db.prepare(`SELECT COUNT(*) n FROM orders WHERE status = 'received'`).get()).n;
  const cancelled = (await db.prepare(`SELECT COUNT(*) n FROM orders WHERE status IN ('cancelled','rejected') AND date(created_at) BETWEEN ? AND ?`).get(from, to)).n;
  const stockValue = (await db.prepare('SELECT COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity * unit_cost END),0) v FROM stock_items WHERE active = 1').get()).v;
  const lowStock = (await db.prepare('SELECT COUNT(*) n FROM stock_items WHERE active = 1 AND quantity <= min_quantity').get()).n;
  const recipesConfigured = (await db.prepare('SELECT COUNT(DISTINCT product_id) n FROM recipes WHERE product_id IS NOT NULL').get()).n;
  const t = today();
  const month = t.slice(0, 8) + '01';
  return {
    revenue: rev.revenue,
    revenue_today: (await sumRevenue(t, t)).revenue,
    revenue_month: (await sumRevenue(month, t)).revenue,
    orders_received: received,
    orders_in_progress: inProgress,
    orders_pending: pending,
    orders_completed: rev.n,
    orders_cancelled: cancelled,
    avg_ticket: rev.n ? Math.round(rev.revenue / rev.n) : 0,
    cmv: rev.cmv,
    delivery_fees: rev.fees,
    other_income: other,
    expenses_total: exp.total,
    expenses_operational: exp.operational,
    profit_estimate: rev.revenue + other - rev.cmv - exp.operational,
    stock_value: Math.round(stockValue),
    low_stock_count: lowStock,
    recipes_configured: recipesConfigured
  };
}

async function productRanking(from, to, limit = 10, order = 'DESC') {
  return await db.prepare(`SELECT i.product_name name, SUM(i.quantity) qty, SUM(i.total) revenue FROM order_items i
    JOIN orders o ON o.id = i.order_id WHERE ${DONE} AND date(o.completed_at) BETWEEN ? AND ?
    GROUP BY i.product_name ORDER BY qty ${order === 'ASC' ? 'ASC' : 'DESC'}, revenue ${order === 'ASC' ? 'ASC' : 'DESC'} LIMIT ?`).all(from, to, limit);
}

async function charts(from, to) {
  // vendas por dia no período
  const daily = await db.prepare(`SELECT date(completed_at) d, COUNT(*) n, SUM(total) v FROM orders o WHERE ${DONE}
    AND date(completed_at) BETWEEN ? AND ? GROUP BY d`).all(from, to);
  const map = Object.fromEntries(daily.map(r => [r.d, r]));
  const days = [];
  const span = Math.min(daysBetween(from, to), 370);
  for (let i = 0; i <= span; i++) { const d = addDays(from, i); days.push({ date: d, orders: map[d]?.n || 0, revenue: map[d]?.v || 0 }); }

  // faturamento semanal (últimas 12 semanas) e mensal (últimos 12 meses)
  const t = today();
  const weekly = [];
  for (let w = 11; w >= 0; w--) {
    const end = addDays(t, -7 * w); const start = addDays(end, -6);
    weekly.push({ label: `${start.slice(8, 10)}/${start.slice(5, 7)}`, from: start, to: end, revenue: (await sumRevenue(start, end)).revenue });
  }
  const monthly = [];
  const base = new Date(t + 'T12:00:00');
  for (let m = 11; m >= 0; m--) {
    const d = new Date(base.getFullYear(), base.getMonth() - m, 1, 12);
    const start = d.toISOString().slice(0, 10);
    const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
    const end = endD.toISOString().slice(0, 10);
    const r = await sumRevenue(start, end); const e = await sumExpenses(start, end);
    monthly.push({ label: start.slice(5, 7) + '/' + start.slice(2, 4), revenue: r.revenue, expenses: e.total, profit: r.revenue - r.cmv - e.operational });
  }

  // comparativo com o período anterior de mesmo tamanho
  const len = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1); const prevFrom = addDays(prevTo, -(len - 1));
  const cur = await sumRevenue(from, to); const prev = await sumRevenue(prevFrom, prevTo);
  const comparison = {
    current: { from, to, revenue: cur.revenue, orders: cur.n },
    previous: { from: prevFrom, to: prevTo, revenue: prev.revenue, orders: prev.n }
  };

  const byCategory = await db.prepare(`SELECT COALESCE(NULLIF(i.category_name,''),'Sem categoria') name, SUM(i.total) revenue, SUM(i.quantity) qty
    FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${DONE} AND date(o.completed_at) BETWEEN ? AND ?
    GROUP BY name ORDER BY revenue DESC`).all(from, to);
  const byPayment = (await db.prepare(`SELECT payment_method m, COUNT(*) n, SUM(total) revenue FROM orders o WHERE ${DONE}
    AND date(completed_at) BETWEEN ? AND ? GROUP BY m ORDER BY revenue DESC`).all(from, to))
    .map(r => ({ name: PAYMENT_LABELS[r.m] || r.m, orders: r.n, revenue: r.revenue }));
  return { daily: days, weekly, monthly, comparison, byCategory, byPayment };
}

async function alerts() {
  const out = [];
  const t = today();
  for (const s of await db.prepare('SELECT id, name, quantity, min_quantity, unit FROM stock_items WHERE active = 1 AND quantity <= min_quantity ORDER BY quantity').all()) {
    if (s.quantity <= 0) out.push({ level: 'danger', type: 'stock_out', text: `${s.name} está ESGOTADO`, ref: s.id });
    else out.push({ level: 'warning', type: 'stock_low', text: `Estoque baixo: ${s.name} (${fmtQty(s.quantity)} ${s.unit}, mínimo ${fmtQty(s.min_quantity)}) — repor`, ref: s.id });
  }
  const days = Number(await getSetting('expiry_alert_days')) || 7;
  for (const s of await db.prepare(`SELECT id, name, expires_at FROM stock_items WHERE active = 1 AND expires_at IS NOT NULL AND expires_at != ''
    AND quantity > 0 AND expires_at <= ? ORDER BY expires_at`).all(addDays(t, days))) {
    out.push({ level: s.expires_at < t ? 'danger' : 'warning', type: 'expiry', text: s.expires_at < t ? `${s.name} VENCEU em ${br(s.expires_at)}` : `${s.name} vence em ${br(s.expires_at)}`, ref: s.id });
  }
  const billDays = Number(await getSetting('bills_alert_days')) || 3;
  for (const b of await db.prepare(`SELECT id, description, category, amount, due_date FROM finance_entries WHERE type='expense' AND status='open'
    AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date`).all(addDays(t, billDays))) {
    out.push({ level: b.due_date < t ? 'danger' : 'warning', type: 'bill', text: `${b.due_date < t ? 'Conta VENCIDA' : 'Conta vence'} em ${br(b.due_date)}: ${b.description || b.category} — ${money(b.amount)}`, ref: b.id });
  }
  const pending = (await db.prepare(`SELECT COUNT(*) n FROM orders WHERE status = 'received'`).get()).n;
  if (pending) out.push({ level: 'info', type: 'orders', text: `${pending} pedido(s) aguardando confirmação` });
  const pixPending = (await db.prepare(`SELECT COUNT(*) n FROM orders WHERE payment_method='pix' AND payment_status='pending' AND status IN ${OPEN_STATUSES}`).get()).n;
  if (pixPending) out.push({ level: 'info', type: 'pix', text: `${pixPending} pedido(s) com PIX aguardando conferência do pagamento` });
  for (const c of await db.prepare(`SELECT id, closed_at, difference FROM cash_sessions WHERE status='closed' AND difference != 0
    AND date(closed_at) >= ? ORDER BY id DESC`).all(addDays(t, -7))) {
    out.push({ level: Math.abs(c.difference) >= 1000 ? 'danger' : 'warning', type: 'cash', text: `Diferença no fechamento do caixa de ${br(c.closed_at.slice(0, 10))}: ${money(c.difference)}`, ref: c.id });
  }
  // despesas acima da média (mês atual vs média dos 3 meses anteriores, por categoria)
  const monthStart = t.slice(0, 8) + '01';
  const cur = await db.prepare(`SELECT category, SUM(amount) v FROM finance_entries WHERE type='expense' AND status!='cancelled'
    AND competence_date >= ? GROUP BY category`).all(monthStart);
  const prevStart = new Date(new Date(monthStart + 'T12:00:00').setMonth(new Date(monthStart + 'T12:00:00').getMonth() - 3)).toISOString().slice(0, 10);
  for (const c of cur) {
    const prev = await db.prepare(`SELECT SUM(amount) v, COUNT(DISTINCT substr(competence_date,1,7)) m FROM finance_entries WHERE type='expense'
      AND status!='cancelled' AND category = ? AND competence_date >= ? AND competence_date < ?`).get(c.category, prevStart, monthStart);
    if (prev.m >= 2) {
      const avg = prev.v / 3;
      if (avg > 0 && c.v > avg * 1.3) out.push({ level: 'warning', type: 'expense', text: `Despesas com "${c.category}" neste mês (${money(c.v)}) estão acima da média (${money(Math.round(avg))})` });
    }
  }
  return out;
}

const money = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const br = (d) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '';
const fmtQty = (q) => Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

// ---------- Relatórios ----------
const REASON_LABELS = {
  compra: 'Compra', reposicao: 'Reposição', devolucao: 'Devolução', ajuste_pos: 'Ajuste positivo', estorno_cancelamento: 'Estorno de cancelamento',
  producao: 'Produção', perda: 'Perda', vencido: 'Vencido', dano: 'Dano', ajuste_neg: 'Ajuste negativo'
};

const REPORTS = {
  vendas: { title: 'Vendas por período', perm: 'reports.operational' },
  mais_vendidos: { title: 'Produtos mais vendidos', perm: 'reports.operational' },
  maior_faturamento: { title: 'Produtos com maior faturamento', perm: 'reports.operational' },
  margem: { title: 'Produtos com maior margem estimada', perm: 'reports.financial' },
  despesas: { title: 'Despesas mensais', perm: 'reports.financial' },
  compras: { title: 'Compras de fornecedores', perm: 'reports.financial' },
  estoque: { title: 'Histórico de estoque', perm: 'reports.operational' },
  perdas: { title: 'Perdas e desperdícios', perm: 'reports.operational' },
  lucro: { title: 'Lucro estimado por período', perm: 'reports.financial' },
  delivery: { title: 'Desempenho do delivery', perm: 'reports.operational' },
  presencial: { title: 'Desempenho do atendimento presencial', perm: 'reports.operational' }
};

async function report(type, from, to) {
  const M = (v) => ({ money: v });
  switch (type) {
    case 'vendas': {
      const rows = await db.prepare(`SELECT date(completed_at) d, COUNT(*) n, SUM(total) v, SUM(delivery_fee) f FROM orders o WHERE ${DONE}
        AND date(completed_at) BETWEEN ? AND ? GROUP BY d ORDER BY d`).all(from, to);
      return { columns: ['Data', 'Pedidos', 'Faturamento', 'Taxas de entrega', 'Ticket médio'],
        rows: rows.map(r => [br(r.d), r.n, M(r.v), M(r.f), M(Math.round(r.v / r.n))]),
        totals: ['Total', rows.reduce((s, r) => s + r.n, 0), M(rows.reduce((s, r) => s + r.v, 0)), M(rows.reduce((s, r) => s + r.f, 0)), ''] };
    }
    case 'mais_vendidos':
    case 'maior_faturamento': {
      const rows = await db.prepare(`SELECT i.product_name name, SUM(i.quantity) qty, SUM(i.total) revenue FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE ${DONE} AND date(o.completed_at) BETWEEN ? AND ? GROUP BY name ORDER BY ${type === 'mais_vendidos' ? 'qty' : 'revenue'} DESC`).all(from, to);
      return { columns: ['Produto', 'Quantidade', 'Faturamento'], rows: rows.map(r => [r.name, r.qty, M(r.revenue)]) };
    }
    case 'margem': {
      const items = await db.prepare(`SELECT i.product_id, i.size_id, i.product_name, i.size_name, i.quantity, i.total, i.addons FROM order_items i
        JOIN orders o ON o.id = i.order_id WHERE ${DONE} AND date(o.completed_at) BETWEEN ? AND ?`).all(from, to);
      const agg = new Map();
      for (const i of items) {
        const key = i.product_name + (i.size_name ? ` (${i.size_name})` : '');
        const a = agg.get(key) || { qty: 0, revenue: 0, cost: 0, hasRecipe: false };
        const c = i.product_id ? await itemCost(i.product_id, i.size_id, JSON.parse(i.addons)) : 0;
        a.qty += i.quantity; a.revenue += i.total; a.cost += c * i.quantity; a.hasRecipe = a.hasRecipe || c > 0;
        agg.set(key, a);
      }
      const rows = [...agg.entries()].map(([k, a]) => [k, a.qty, M(a.revenue), a.hasRecipe ? M(a.cost) : 'sem ficha técnica',
        a.hasRecipe ? M(a.revenue - a.cost) : '-', a.hasRecipe && a.revenue ? ((a.revenue - a.cost) / a.revenue * 100).toFixed(1) + '%' : '-',
        a.hasRecipe && a.revenue ? (a.revenue - a.cost) / a.revenue : -1]);
      rows.sort((x, y) => y[6] - x[6]);
      return { columns: ['Produto', 'Qtd.', 'Faturamento', 'Custo estimado', 'Margem R$', 'Margem %'], rows: rows.map(r => r.slice(0, 6)),
        note: 'Custo calculado pelas fichas técnicas com o custo médio atual dos ingredientes.' };
    }
    case 'despesas': {
      const rows = await db.prepare(`SELECT substr(competence_date,1,7) m, category, SUM(amount) v, SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) paid
        FROM finance_entries WHERE type='expense' AND status!='cancelled' AND competence_date BETWEEN ? AND ? GROUP BY m, category ORDER BY m, v DESC`).all(from, to);
      return { columns: ['Mês', 'Categoria', 'Total', 'Pago', 'A pagar'],
        rows: rows.map(r => [r.m.slice(5) + '/' + r.m.slice(0, 4), r.category, M(r.v), M(r.paid), M(r.v - r.paid)]),
        totals: ['Total', '', M(rows.reduce((s, r) => s + r.v, 0)), M(rows.reduce((s, r) => s + r.paid, 0)), M(rows.reduce((s, r) => s + r.v - r.paid, 0))] };
    }
    case 'compras': {
      const rows = await db.prepare(`SELECT p.id, date(p.created_at) d, s.name supplier, p.total, p.status, p.due_date,
        (SELECT status FROM finance_entries f WHERE f.purchase_id = p.id AND f.status != 'cancelled' LIMIT 1) fin
        FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE date(p.created_at) BETWEEN ? AND ? ORDER BY p.created_at`).all(from, to);
      const st = { pending: 'Aguardando entrega', received: 'Recebida', cancelled: 'Cancelada' };
      return { columns: ['Nº', 'Data', 'Fornecedor', 'Valor', 'Situação', 'Vencimento', 'Pagamento'],
        rows: rows.map(r => [r.id, br(r.d), r.supplier || '-', M(r.total), st[r.status], br(r.due_date), r.fin === 'paid' ? 'Pago' : (r.fin === 'open' ? 'Em aberto' : '-')]) };
    }
    case 'estoque':
    case 'perdas': {
      const where = type === 'perdas' ? "AND m.reason IN ('perda','vencido','dano')" : '';
      const rows = await db.prepare(`SELECT m.created_at, s.name item, s.unit, m.direction, m.reason, m.quantity, m.total_value, m.note, u.name user
        FROM stock_movements m JOIN stock_items s ON s.id = m.item_id LEFT JOIN users u ON u.id = m.user_id
        WHERE date(m.created_at) BETWEEN ? AND ? ${where} ORDER BY m.id`).all(from, to);
      return { columns: ['Data/hora', 'Item', 'Tipo', 'Motivo', 'Quantidade', 'Valor', 'Responsável', 'Observação'],
        rows: rows.map(r => [br(r.created_at.slice(0, 10)) + ' ' + r.created_at.slice(11, 16), r.item, r.direction === 'in' ? 'Entrada' : 'Saída',
          REASON_LABELS[r.reason] || r.reason, `${fmtQty(r.quantity)} ${r.unit}`, M(r.total_value), r.user || 'Sistema', r.note]),
        totals: type === 'perdas' ? ['Total perdido', '', '', '', '', M(rows.reduce((s, r) => s + r.total_value, 0)), '', ''] : null };
    }
    case 'lucro': {
      const rows = [];
      let cur = from;
      // agrupa por mês se o período for longo, senão por dia
      const monthly = daysBetween(from, to) > 62;
      while (cur <= to) {
        let end = cur;
        if (monthly) {
          const d = new Date(cur + 'T12:00:00');
          end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).toISOString().slice(0, 10);
          if (end > to) end = to;
        }
        const r = await sumRevenue(cur, end); const e = await sumExpenses(cur, end); const o = await otherIncome(cur, end);
        if (r.revenue || e.total || o) rows.push([monthly ? cur.slice(5, 7) + '/' + cur.slice(0, 4) : br(cur), M(r.revenue), M(o), M(r.cmv), M(e.operational), M(r.revenue + o - r.cmv - e.operational)]);
        cur = addDays(end, 1);
      }
      const r = await sumRevenue(from, to); const e = await sumExpenses(from, to); const o = await otherIncome(from, to);
      return { columns: ['Período', 'Faturamento', 'Outras receitas', 'CMV estimado', 'Despesas operacionais', 'Lucro estimado'], rows,
        totals: ['Total', M(r.revenue), M(o), M(r.cmv), M(e.operational), M(r.revenue + o - r.cmv - e.operational)],
        note: 'Lucro estimado = faturamento + outras receitas − custo dos produtos vendidos (fichas técnicas) − despesas operacionais. Compras de mercadoria entram pelo custo das fichas técnicas.' };
    }
    case 'delivery':
    case 'presencial': {
      const where = type === 'delivery' ? "mode = 'delivery'" : "mode IN ('pickup','local')";
      const rows = await db.prepare(`SELECT date(completed_at) d, COUNT(*) n, SUM(total) v, SUM(delivery_fee) f,
        AVG((julianday(completed_at) - julianday(created_at)) * 1440) mins FROM orders o
        WHERE ${DONE} AND ${where} AND date(completed_at) BETWEEN ? AND ? GROUP BY d ORDER BY d`).all(from, to);
      const cancelled = (await db.prepare(`SELECT COUNT(*) n FROM orders WHERE status IN ('cancelled','rejected') AND ${where} AND date(created_at) BETWEEN ? AND ?`).get(from, to)).n;
      const cols = ['Data', 'Pedidos', 'Faturamento', 'Ticket médio', ...(type === 'delivery' ? ['Taxas de entrega'] : []), 'Tempo médio (min)'];
      return { columns: cols,
        rows: rows.map(r => [br(r.d), r.n, M(r.v), M(Math.round(r.v / r.n)), ...(type === 'delivery' ? [M(r.f)] : []), Math.round(r.mins)]),
        totals: ['Total', rows.reduce((s, r) => s + r.n, 0), M(rows.reduce((s, r) => s + r.v, 0)), '', ...(type === 'delivery' ? [M(rows.reduce((s, r) => s + r.f, 0))] : []), ''],
        note: `Pedidos cancelados/recusados no período: ${cancelled}. ${type === 'presencial' ? 'Inclui retirada na loja e vendas de balcão.' : ''}` };
    }
    default: return null;
  }
}

module.exports = { resolvePeriod, kpis, charts, alerts, productRanking, report, REPORTS, REASON_LABELS, money, br, fmtQty, itemCost, addDays, STOCK_EXPENSE_CATEGORIES };
