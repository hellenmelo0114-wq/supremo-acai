// Regras de negócio: preço dos pedidos, status, baixa de estoque, venda e cancelamento.
const crypto = require('crypto');
const { db, tx, getSetting, allSettings, audit } = require('./db');
const bus = require('./bus');

const STATUS_FLOW = ['received', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
const STATUS_LABELS = {
  received: 'Pedido recebido',
  confirmed: 'Pedido confirmado',
  preparing: 'Em preparação',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Pedido entregue',
  rejected: 'Pedido recusado',
  cancelled: 'Pedido cancelado'
};
const PAYMENT_LABELS = { pix: 'PIX', cash: 'Dinheiro', credit: 'Cartão de crédito', debit: 'Cartão de débito' };
const MODE_LABELS = { delivery: 'Delivery', pickup: 'Retirada na loja', local: 'Consumo no local' };

function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const today = () => nowLocal().slice(0, 10);

// Horário de funcionamento (ex.: 16:00 às 23:00; aceita horário que passa da meia-noite)
function withinHours(s) {
  if (!s.open_time || !s.close_time) return true;
  const now = nowLocal().slice(11, 16);
  return s.open_time <= s.close_time ? (now >= s.open_time && now < s.close_time) : (now >= s.open_time || now < s.close_time);
}

function newCode() {
  // 10 caracteres sem ambiguidade (sem 0/O/1/I) — difícil de adivinhar
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

// ---------- Promoções ativas ----------
async function activePromotions() {
  const now = nowLocal();
  return await db.prepare(`SELECT * FROM promotions WHERE active = 1
    AND (starts_at IS NULL OR starts_at = '' OR starts_at <= ?)
    AND (ends_at IS NULL OR ends_at = '' OR ends_at >= ?) ORDER BY id DESC`).all(now, now);
}
function promoPrice(productId, basePrice, promos) {
  const p = promos.find(x => x.product_id === productId && x.discount_type !== 'none');
  if (!p) return { price: basePrice, promo: null };
  let price = basePrice;
  if (p.discount_type === 'percent') price = Math.round(basePrice * (100 - Math.min(100, p.discount_value)) / 100);
  if (p.discount_type === 'fixed') price = Math.max(0, basePrice - p.discount_value);
  return { price, promo: p };
}

// ---------- Cálculo do pedido (SEMPRE no servidor; valores do navegador são ignorados) ----------
async function priceCart(items, mode) {
  if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'O carrinho está vazio.');
  if (items.length > 60) throw httpError(400, 'Pedido com itens demais.');
  const promos = await activePromotions();
  const settings = await allSettings();
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const qty = parseInt(it.quantity, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw httpError(400, 'Quantidade inválida.');
    const prod = await db.prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ? AND p.active = 1`).get(it.product_id);
    if (!prod) throw httpError(400, 'Um dos produtos não está mais disponível. Atualize o carrinho.');
    const sizes = await db.prepare('SELECT * FROM product_sizes WHERE product_id = ? AND active = 1 ORDER BY sort, id').all(prod.id);
    let base = prod.price; let size = null;
    if (sizes.length) {
      size = sizes.find(s => s.id === Number(it.size_id));
      if (!size) throw httpError(400, `Escolha o tamanho de "${prod.name}".`);
      base = size.price;
    }
    const { price: unitBase } = promoPrice(prod.id, base, promos);

    // adicionais permitidos para este produto
    const groups = await db.prepare(`SELECT g.* FROM addon_groups g JOIN product_addon_groups pg ON pg.group_id = g.id
      WHERE pg.product_id = ? AND g.active = 1`).all(prod.id);
    const chosenIds = [...new Set((it.addons || []).map(Number))];
    const chosen = [];
    for (const g of groups) {
      const opts = await db.prepare('SELECT * FROM addons WHERE group_id = ? AND active = 1').all(g.id);
      const picked = opts.filter(o => chosenIds.includes(o.id));
      if (g.min_select && picked.length < g.min_select) throw httpError(400, `Escolha pelo menos ${g.min_select} em "${g.name}" (${prod.name}).`);
      if (g.max_select && picked.length > g.max_select) throw httpError(400, `Escolha no máximo ${g.max_select} em "${g.name}" (${prod.name}).`);
      chosen.push(...picked.map(o => ({ id: o.id, name: o.name, price: o.price, group: g.name })));
    }
    if (chosen.length !== chosenIds.length) throw httpError(400, 'Adicional inválido no carrinho. Atualize a página.');
    const unit = unitBase + chosen.reduce((s, a) => s + a.price, 0);
    const total = unit * qty;
    subtotal += total;
    lines.push({
      product_id: prod.id, size_id: size ? size.id : null, product_name: prod.name, category_name: prod.category_name || '',
      size_name: size ? size.name : null, unit_price: unit, quantity: qty, addons: chosen,
      notes: String(it.notes || '').slice(0, 300), total
    });
  }
  const deliveryFee = mode === 'delivery' ? Number(settings.delivery_fee) || 0 : 0;
  return { lines, subtotal, delivery_fee: deliveryFee, discount: 0, total: subtotal + deliveryFee };
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

async function createOrder(input, { channel = 'online', user = null } = {}) {
  const s = await allSettings();
  const mode = input.mode;
  if (!['delivery', 'pickup', 'local'].includes(mode)) throw httpError(400, 'Escolha delivery ou retirada.');
  if (channel === 'online') {
    if (!s.store_open) throw httpError(400, 'A loja está fechada no momento. Tente novamente mais tarde.');
    if (!withinHours(s)) throw httpError(400, `Estamos fechados agora. Nosso horário é ${s.opening_hours || `das ${s.open_time} às ${s.close_time}`}.`);
    if (mode === 'delivery' && !s.delivery_enabled) throw httpError(400, 'O delivery não está disponível agora.');
    if (mode === 'pickup' && !s.pickup_enabled) throw httpError(400, 'A retirada não está disponível agora.');
    if (mode === 'local') throw httpError(400, 'Modalidade inválida.');
  }
  const name = String(input.customer_name || '').trim().slice(0, 80);
  const phone = String(input.customer_phone || '').replace(/\D/g, '').slice(0, 13);
  if (channel === 'online') {
    if (name.length < 2) throw httpError(400, 'Informe seu nome.');
    if (phone.length < 10) throw httpError(400, 'Informe um WhatsApp válido com DDD.');
  }
  const address = String(input.address || '').trim().slice(0, 300);
  if (mode === 'delivery' && address.length < 8) throw httpError(400, 'Informe o endereço completo para entrega.');
  const pm = input.payment_method;
  if (!PAYMENT_LABELS[pm]) throw httpError(400, 'Escolha a forma de pagamento.');
  if (channel === 'online' && s.payments[pm] && s.payments[pm].enabled === false) throw httpError(400, 'Forma de pagamento indisponível.');

  const priced = await priceCart(input.items, mode);
  if (channel === 'online' && s.min_order && priced.subtotal < s.min_order) {
    throw httpError(400, `Pedido mínimo de R$ ${(s.min_order / 100).toFixed(2).replace('.', ',')}.`);
  }
  let changeFor = null;
  if (pm === 'cash' && input.change_for) {
    changeFor = Math.round(Number(String(input.change_for).replace(',', '.')) * 100) || null;
    if (changeFor && changeFor < priced.total) throw httpError(400, 'O valor para troco deve ser maior que o total.');
  }

  return tx(async () => {
    const code = newCode();
    const initialStatus = channel === 'balcao' ? 'confirmed' : 'received';
    const r = await db.prepare(`INSERT INTO orders (code, channel, mode, customer_name, customer_phone, address, address_ref,
      payment_method, change_for, notes, subtotal, discount, delivery_fee, total, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      code, channel, mode, name || 'Balcão', phone, mode === 'delivery' ? address : '',
      mode === 'delivery' ? String(input.address_ref || '').slice(0, 200) : '',
      pm, changeFor, String(input.notes || '').slice(0, 500), priced.subtotal, priced.discount,
      priced.delivery_fee, priced.total, initialStatus);
    const orderId = Number(r.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO order_items (order_id, product_id, size_id, product_name, category_name, size_name,
      unit_price, quantity, addons, notes, total) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of priced.lines) {
      await ins.run(orderId, l.product_id, l.size_id, l.product_name, l.category_name, l.size_name, l.unit_price, l.quantity,
        JSON.stringify(l.addons), l.notes, l.total);
    }
    await db.prepare('INSERT INTO order_status_history (order_id, status, user_id) VALUES (?,?,?)').run(orderId, 'received', user ? user.id : null);
    if (initialStatus === 'confirmed') {
      await db.prepare('INSERT INTO order_status_history (order_id, status, user_id) VALUES (?,?,?)').run(orderId, 'confirmed', user.id);
    }
    if (user) await audit(user, 'order.create_counter', 'order', orderId, { code, total: priced.total });
    const order = await getOrder(orderId);
    bus.emit('order', { type: 'new', order });
    return order;
  });
}

async function getOrder(id) {
  const o = await db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return null;
  o.items = (await db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)).map(i => ({ ...i, addons: JSON.parse(i.addons) }));
  o.history = await db.prepare(`SELECT h.status, h.note, h.created_at, u.name AS user_name FROM order_status_history h
    LEFT JOIN users u ON u.id = h.user_id WHERE h.order_id = ? ORDER BY h.id`).all(id);
  return o;
}
async function getOrderByCode(code) {
  const o = await db.prepare('SELECT id FROM orders WHERE code = ?').get(String(code || '').toUpperCase());
  return o ? getOrder(o.id) : null;
}

// Visão pública (cliente): sem telefone completo, sem dados internos
function publicOrder(o) {
  const phone = o.customer_phone ? o.customer_phone.replace(/^(\d{2})(\d+)(\d{4})$/, (m, a, b, c) => `(${a}) •••••-${c}`) : '';
  return {
    code: o.code, number: o.id, status: o.status, status_label: STATUS_LABELS[o.status], mode: o.mode,
    customer_name: o.customer_name.split(' ')[0], customer_phone: phone,
    address: o.address, address_ref: o.address_ref,
    payment_method: o.payment_method, payment_status: o.payment_status, change_for: o.change_for,
    subtotal: o.subtotal, delivery_fee: o.delivery_fee, discount: o.discount, total: o.total,
    notes: o.notes, created_at: o.created_at, cancel_reason: o.cancel_reason,
    items: o.items.map(i => ({ product_name: i.product_name, size_name: i.size_name, quantity: i.quantity, unit_price: i.unit_price, total: i.total, addons: i.addons.map(a => a.name), notes: i.notes })),
    history: o.history.map(h => ({ status: h.status, label: STATUS_LABELS[h.status], at: h.created_at }))
  };
}

// ---------- Estoque ----------
async function addMovement({ itemId, direction, reason, quantity, unitCost, note = '', orderId = null, purchaseId = null, user = null }) {
  const item = await db.prepare('SELECT * FROM stock_items WHERE id = ?').get(itemId);
  if (!item) throw httpError(400, 'Item de estoque não encontrado.');
  const q = Number(quantity);
  if (!(q > 0)) throw httpError(400, 'Quantidade deve ser maior que zero.');
  const cost = unitCost != null ? Math.round(unitCost) : item.unit_cost;
  let newQty = direction === 'in' ? item.quantity + q : item.quantity - q;
  newQty = Math.round(newQty * 1000) / 1000;
  // custo médio ponderado em entradas de compra/reposição
  let newCost = item.unit_cost;
  if (direction === 'in' && ['compra', 'reposicao'].includes(reason) && unitCost != null) {
    const prevQty = Math.max(0, item.quantity);
    newCost = prevQty + q > 0 ? Math.round((prevQty * item.unit_cost + q * cost) / (prevQty + q)) : cost;
  }
  const isEntry = direction === 'in' && ['compra', 'reposicao', 'devolucao'].includes(reason);
  await db.prepare('UPDATE stock_items SET quantity = ?, unit_cost = ?, last_entry_at = ? WHERE id = ?')
    .run(newQty, newCost, isEntry ? nowLocal() : item.last_entry_at, itemId);
  await db.prepare(`INSERT INTO stock_movements (item_id, direction, reason, quantity, unit_cost, total_value, note, order_id, purchase_id, user_id, balance_after)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(itemId, direction, reason, q, cost, Math.round(q * cost), String(note).slice(0, 300),
    orderId, purchaseId, user ? user.id : null, newQty);
  return newQty;
}

// Ingredientes necessários para um pedido, a partir das fichas técnicas
async function orderIngredients(order) {
  const need = new Map();
  for (const it of order.items) {
    if (!it.product_id) continue;
    const rows = await db.prepare(`SELECT stock_item_id, quantity FROM recipes WHERE product_id = ?
      AND (size_id IS NULL OR size_id = ?)`).all(it.product_id, it.size_id || -1);
    for (const r of rows) need.set(r.stock_item_id, (need.get(r.stock_item_id) || 0) + r.quantity * it.quantity);
    for (const a of it.addons) {
      const ar = await db.prepare('SELECT stock_item_id, quantity FROM recipes WHERE addon_id = ?').all(a.id);
      for (const r of ar) need.set(r.stock_item_id, (need.get(r.stock_item_id) || 0) + r.quantity * it.quantity);
    }
  }
  return need;
}

async function deductStockForOrder(order, user) {
  // trava contra baixa duplicada: só a primeira atualização vence
  const r = await db.prepare('UPDATE orders SET stock_deducted = 1 WHERE id = ? AND stock_deducted = 0').run(order.id);
  if (r.changes === 0) return;
  let cost = 0;
  for (const [itemId, qty] of await orderIngredients(order)) {
    const item = await db.prepare('SELECT unit_cost FROM stock_items WHERE id = ?').get(itemId);
    cost += Math.round(qty * (item ? item.unit_cost : 0));
    await addMovement({ itemId, direction: 'out', reason: 'producao', quantity: qty, note: `Pedido #${order.id}`, orderId: order.id, user });
  }
  await db.prepare('UPDATE orders SET cost_estimate = ? WHERE id = ?').run(cost, order.id);
}

// ---------- Registro da venda (financeiro + caixa) ----------
async function registerSale(order, user) {
  const r = await db.prepare('UPDATE orders SET sale_registered = 1 WHERE id = ? AND sale_registered = 0').run(order.id);
  if (r.changes === 0) return;
  const date = today();
  const category = order.channel === 'balcao' || order.mode === 'local' ? 'Vendas presenciais' : (order.mode === 'delivery' ? 'Vendas delivery' : 'Vendas retirada');
  await db.prepare(`INSERT INTO finance_entries (type, category, description, amount, competence_date, paid_at, status, payment_method, order_id, user_id)
    VALUES ('income', ?, ?, ?, ?, ?, 'paid', ?, ?, ?)`).run(category, `Pedido #${order.id} (${order.code})`, order.total, date,
    nowLocal(), order.payment_method, order.id, user ? user.id : null);
  // taxa de cartão estimada como despesa
  const fees = (await getSetting('card_fee_percent')) || {};
  const pct = Number(fees[order.payment_method] || 0);
  if (pct > 0 && ['credit', 'debit'].includes(order.payment_method)) {
    await db.prepare(`INSERT INTO finance_entries (type, category, description, amount, competence_date, paid_at, status, order_id, user_id)
      VALUES ('expense','Taxas de cartão',?,?,?,?, 'paid', ?, ?)`).run(`Taxa ${pct}% pedido #${order.id}`, Math.round(order.total * pct / 100),
      date, nowLocal(), order.id, user ? user.id : null);
  }
  const session = await db.prepare("SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
  if (session) {
    await db.prepare(`INSERT INTO cash_movements (session_id, type, method, amount, description, order_id, user_id)
      VALUES (?, 'sale', ?, ?, ?, ?, ?)`).run(session.id, order.payment_method, order.total, `Pedido #${order.id}`, order.id, user ? user.id : null);
  }
}

// ---------- Mudança de status ----------
async function changeStatus(orderId, status, user, opts = {}) {
  return tx(async () => {
    const order = await getOrder(orderId);
    if (!order) throw httpError(404, 'Pedido não encontrado.');
    if (['delivered', 'rejected', 'cancelled'].includes(order.status)) throw httpError(400, 'Este pedido já foi finalizado.');
    if (!STATUS_LABELS[status]) throw httpError(400, 'Status inválido.');
    if (status === order.status) return order;

    if (status === 'rejected') {
      if (order.status !== 'received') throw httpError(400, 'Só é possível recusar pedidos ainda não confirmados. Use "Cancelar".');
      await db.prepare("UPDATE orders SET status = 'rejected', cancel_reason = ?, updated_at = ? WHERE id = ?").run(String(opts.reason || '').slice(0, 300), nowLocal(), orderId);
    } else if (status === 'cancelled') {
      if (!opts.reason) throw httpError(400, 'Informe o motivo do cancelamento.');
      if (order.stock_deducted) {
        // ingredientes já baixados: devolver ao estoque ou registrar perda
        for (const [itemId, qty] of await orderIngredients(order)) {
          await addMovement({ itemId, direction: 'in', reason: 'estorno_cancelamento', quantity: qty, note: `Cancelamento pedido #${order.id}`, orderId: order.id, user });
          if (opts.ingredientsLost) {
            await addMovement({ itemId, direction: 'out', reason: 'perda', quantity: qty, note: `Perda no cancelamento do pedido #${order.id}: ${opts.reason}`, orderId: order.id, user });
          }
        }
      }
      if (order.sale_registered) {
        await db.prepare("UPDATE finance_entries SET status = 'cancelled', cancel_reason = ? WHERE order_id = ?").run('Pedido cancelado', orderId);
      }
      await db.prepare("UPDATE orders SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?").run(String(opts.reason).slice(0, 300), nowLocal(), orderId);
    } else {
      const from = STATUS_FLOW.indexOf(order.status);
      const to = STATUS_FLOW.indexOf(status);
      if (to < from) throw httpError(400, 'Não é possível voltar o status do pedido.');
      // a baixa acontece ao entrar em produção (ou se pular direto para etapas seguintes)
      if (to >= STATUS_FLOW.indexOf('preparing')) await deductStockForOrder(order, user);
      if (status === 'delivered') {
        if (order.payment_method === 'pix' && order.payment_status !== 'paid' && !opts.confirmPayment) {
          throw httpError(400, 'O PIX deste pedido ainda não foi confirmado. Confira o recebimento antes de concluir.');
        }
        if (order.payment_status !== 'paid') {
          await db.prepare("UPDATE orders SET payment_status = 'paid', payment_confirmed_by = ? WHERE id = ?").run(user ? user.name : 'sistema', orderId);
        }
        await db.prepare('UPDATE orders SET completed_at = ? WHERE id = ?').run(nowLocal(), orderId);
        await registerSale(await getOrder(orderId), user);
      }
      await db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowLocal(), orderId);
    }
    await db.prepare('INSERT INTO order_status_history (order_id, status, user_id, note) VALUES (?,?,?,?)').run(orderId, status, user ? user.id : null, opts.reason || null);
    await audit(user, 'order.status', 'order', orderId, { from: order.status, to: status, reason: opts.reason, ingredientsLost: !!opts.ingredientsLost });
    const updated = await getOrder(orderId);
    bus.emit('order', { type: 'update', order: updated });
    return updated;
  });
}

async function markPaid(orderId, by, providerRef) {
  const order = await getOrder(orderId);
  if (!order || order.payment_status === 'paid') return order;
  await db.prepare("UPDATE orders SET payment_status = 'paid', payment_confirmed_by = ?, payment_ref = COALESCE(?, payment_ref), updated_at = ? WHERE id = ?")
    .run(by, providerRef || null, nowLocal(), orderId);
  const updated = await getOrder(orderId);
  bus.emit('order', { type: 'update', order: updated });
  return updated;
}

module.exports = {
  withinHours, STATUS_FLOW, STATUS_LABELS, PAYMENT_LABELS, MODE_LABELS, nowLocal, today, httpError,
  activePromotions, promoPrice, priceCart, createOrder, getOrder, getOrderByCode, publicOrder,
  addMovement, changeStatus, markPaid, orderIngredients
};
