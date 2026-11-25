// Teste de ponta a ponta da API (usa dados de TESTE em um banco temporário).
// Uso: npm test   (sobe o servidor num diretório temporário e roda o fluxo completo)
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supremo-test-'));
let cookie = '';

async function call(method, url, body, { raw = false, admin = true } = {}) {
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', ...(admin ? { 'X-Requested-With': 'supremo', Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  if (raw) return r;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${method} ${url} -> ${r.status}: ${data.error}`); e.status = r.status; throw e; }
  return data;
}
const expectFail = async (p, status) => { try { await p; } catch (e) { if (status) assert.strictEqual(e.status, status, e.message); return e; } throw new Error('deveria falhar'); };

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, SEED_MENU: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => { const s = String(d); if (!s.includes('ExperimentalWarning') && !s.includes('trace-warnings')) process.stderr.write(s); });
  await new Promise(r => srv.stdout.once('data', r));
  try {
    // ---- configuração inicial e login
    assert.strictEqual((await call('GET', '/api/auth/setup-needed')).needed, true);
    await expectFail(call('POST', '/api/auth/setup', { name: 'Dona', username: 'dona', password: '123' }), 400);
    await call('POST', '/api/auth/setup', { name: 'Proprietária Teste', username: 'dona', password: 'senhaForte1' });
    await expectFail(call('POST', '/api/auth/setup', { name: 'X', username: 'xx', password: 'senhaForte1' }), 400);
    await call('PUT', '/api/admin/settings', { open_time: '', close_time: '', payments: { pix: { enabled: true, on_site: false }, cash: { enabled: true }, credit: { enabled: true }, debit: { enabled: true } } });
    const me = await call('GET', '/api/auth/me');
    assert.strictEqual(me.user.role, 'owner');
    // CSRF: sem cabeçalho é bloqueado
    const blocked = await fetch(BASE + '/api/admin/categories', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{"name":"x"}' });
    assert.strictEqual(blocked.status, 403);

    // ---- estoque
    const acai = (await call('POST', '/api/admin/stock', { name: 'Açaí (teste)', unit: 'ml', quantity: 10000, min_quantity: 2000, unit_cost: '0.02' })).id; // R$0,02/ml
    const granola = (await call('POST', '/api/admin/stock', { name: 'Granola (teste)', unit: 'g', quantity: 1000, min_quantity: 200, unit_cost: '0.03' })).id;
    const copo = (await call('POST', '/api/admin/stock', { name: 'Copo 500 (teste)', unit: 'un', quantity: 3, min_quantity: 5, unit_cost: '0.50' })).id;
    // ---- catálogo
    const cat = (await call('POST', '/api/admin/categories', { name: 'Açaí (teste)' })).id;
    const grp = (await call('POST', '/api/admin/addon-groups', { name: 'Complementos', min_select: 0, max_select: 2, addons: [{ name: 'Granola', price: '2.00' }, { name: 'Leite em pó', price: '1.50' }, { name: 'Banana', price: '1' }] })).id;
    const catalog0 = await call('GET', '/api/admin/catalog');
    const granolaAddon = catalog0.addon_groups[0].addons.find(a => a.name === 'Granola');
    const prod = (await call('POST', '/api/admin/products', { name: 'Açaí teste', category_id: cat, description: 'Produto de teste', sizes: [{ name: '300 ml', price: '12' }, { name: '500 ml', price: '18' }], addon_group_ids: [grp], featured: true })).id;
    let catalog = await call('GET', '/api/admin/catalog');
    const p = catalog.categories[0].products[0];
    const s500 = p.sizes.find(s => s.name === '500 ml');
    await call('PUT', `/api/admin/recipes/product/${prod}`, { lines: [{ size_id: s500.id, stock_item_id: acai, quantity: 500 }, { size_id: null, stock_item_id: copo, quantity: 1 }] });
    await call('PUT', `/api/admin/recipes/addon/${granolaAddon.id}`, { lines: [{ stock_item_id: granola, quantity: 20 }] });

    // ---- pedido do cliente (preço é recalculado no servidor)
    const menu = await call('GET', '/api/public/menu', null, { admin: false });
    assert.strictEqual(menu.categories[0].products.length, 1);
    await expectFail(call('POST', '/api/orders', { customer_name: 'Cliente', customer_phone: '71999990000', mode: 'delivery', address: 'Rua Teste, 10, Centro', payment_method: 'pix', items: [{ product_id: prod, quantity: 1 }] }, { admin: false }), 400); // sem tamanho
    await expectFail(call('POST', '/api/orders', { customer_name: 'Cliente', customer_phone: '71999990000', mode: 'delivery', address: 'Rua Teste, 10, Centro', payment_method: 'pix', items: [{ product_id: prod, size_id: s500.id, quantity: 1, addons: catalog0.addon_groups[0].addons.map(a => a.id) }] }, { admin: false }), 400); // acima do máximo
    const order = await call('POST', '/api/orders', { customer_name: 'Cliente Teste', customer_phone: '(71) 99999-0000', mode: 'delivery', address: 'Rua Teste, 10, Centro', address_ref: 'perto da praça', payment_method: 'pix',
      items: [{ product_id: prod, size_id: s500.id, quantity: 2, addons: [granolaAddon.id], notes: 'sem banana', unit_price: 1 }] }, { admin: false });
    assert.strictEqual(order.subtotal, 2 * (1800 + 200));
    assert.strictEqual(order.delivery_fee, 500);
    assert.strictEqual(order.total, 4500);
    assert.ok(!order.customer_phone.includes('99999'), 'telefone mascarado na visão pública');
    const pub = await call('GET', `/api/orders/${order.code}`, null, { admin: false });
    assert.strictEqual(pub.status, 'received');
    const pix = await call('GET', `/api/orders/${order.code}/pix`, null, { admin: false });
    assert.strictEqual(pix.provider, 'manual'); // chave ainda não configurada

    // ---- configurações: chave PIX e taxa
    await call('PUT', '/api/admin/settings', { delivery_fee: '6,00', payments: { pix: { enabled: true, on_site: false, key: '71992713438', key_type: 'phone', receiver_name: 'Teste', receiver_city: 'Madre de Deus' }, cash: { enabled: true }, credit: { enabled: true }, debit: { enabled: true } } });
    const pix2 = await call('GET', `/api/orders/${order.code}/pix`, null, { admin: false });
    assert.ok(pix2.payload.startsWith('000201') && pix2.payload.includes('br.gov.bcb.pix') && pix2.payload.includes('540545.00'));
    assert.ok(pix2.qr.startsWith('data:image/png'));
    assert.strictEqual((await call('GET', '/api/public/config', null, { admin: false })).delivery_fee, 600);

    // ---- fluxo de status com baixa automática de estoque (sem duplicar)
    const oid = order.number;
    await call('POST', `/api/admin/orders/${oid}/status`, { status: 'confirmed' });
    await call('POST', `/api/admin/orders/${oid}/status`, { status: 'preparing' });
    let stock = await call('GET', '/api/admin/stock');
    const q = (id) => stock.find(s => s.id === id).quantity;
    assert.strictEqual(q(acai), 10000 - 1000);
    assert.strictEqual(q(granola), 1000 - 40);
    assert.strictEqual(q(copo), 1);
    await call('POST', `/api/admin/orders/${oid}/status`, { status: 'out_for_delivery' });
    stock = await call('GET', '/api/admin/stock');
    assert.strictEqual(q(acai), 9000, 'sem baixa duplicada');
    await expectFail(call('POST', `/api/admin/orders/${oid}/status`, { status: 'confirmed' }), 400); // não volta
    await expectFail(call('POST', `/api/admin/orders/${oid}/status`, { status: 'delivered' }), 400); // PIX não conferido

    // ---- caixa
    await call('POST', '/api/admin/cash/open', { opening_amount: '100' });
    await call('POST', `/api/admin/orders/${oid}/confirm-payment`, {});
    await call('POST', `/api/admin/orders/${oid}/status`, { status: 'delivered' });
    // venda de balcão em dinheiro, finalizada na hora
    const counter = await call('POST', '/api/admin/orders', { mode: 'local', payment_method: 'cash', finish_now: true, items: [{ product_id: prod, size_id: p.sizes[0].id, quantity: 1 }] });
    assert.strictEqual(counter.status, 'delivered');
    assert.strictEqual(counter.total, 1200);
    await call('POST', '/api/admin/cash/movement', { type: 'sangria', amount: '50', description: 'Cofre' });
    const cash = await call('GET', '/api/admin/cash/current');
    assert.strictEqual(cash.live_expected.cash, 10000 + 1200 - 5000);
    assert.strictEqual(cash.live_expected.pix, 4500);
    const closed = await call('POST', '/api/admin/cash/close', { counted: { cash: '61', pix: '45', credit: 0, debit: 0 } });
    assert.strictEqual(closed.difference, -100);

    // ---- financeiro: despesas e lucro estimado
    await call('POST', '/api/admin/finance', { type: 'expense', category: 'Energia', amount: '10', paid: true });
    const sup = (await call('POST', '/api/admin/suppliers', { name: 'Fornecedor Teste', whatsapp: '71900000000' })).id;
    const pur = (await call('POST', '/api/admin/purchases', { supplier_id: sup, due_date: '2099-01-01', items: [{ stock_item_id: copo, quantity: 100, unit_cost: '0.40' }] })).id;
    await call('POST', `/api/admin/purchases/${pur}/receive`, {});
    stock = await call('GET', '/api/admin/stock');
    assert.strictEqual(q(copo), 1 - 1 + 100); // 1 copo usado na venda de balcão
    const dash = await call('GET', '/api/admin/dashboard?period=today');
    assert.strictEqual(dash.kpis.revenue, 4500 + 1200);
    assert.strictEqual(dash.kpis.orders_completed, 2);
    // CMV: pedido 1 = 2*(500ml*2c + 1 copo*50c + 20g*3c) = 2*(1000+50+60)=2220 ; balcão: 1 copo = 50
    assert.strictEqual(dash.kpis.cmv, 2220 + 50);
    assert.strictEqual(dash.kpis.profit_estimate, 5700 - 2270 - 1000);
    assert.ok(dash.alerts.some(a => a.type === 'cash'), 'alerta de diferença de caixa');
    const fin = await call('GET', '/api/admin/finance');
    assert.strictEqual(fin.summary.payable, 4000);

    // ---- cancelamento com perda de ingredientes
    const o2 = await call('POST', '/api/orders', { customer_name: 'Cliente 2', customer_phone: '71988887777', mode: 'pickup', payment_method: 'cash', items: [{ product_id: prod, size_id: s500.id, quantity: 1 }] }, { admin: false });
    await call('POST', `/api/admin/orders/${o2.number}/status`, { status: 'preparing' });
    await expectFail(call('POST', `/api/admin/orders/${o2.number}/status`, { status: 'cancelled' }), 400); // motivo obrigatório
    await call('POST', `/api/admin/orders/${o2.number}/status`, { status: 'cancelled', reason: 'Cliente desistiu', ingredientsLost: true });
    const losses = await call('GET', `/api/admin/reports/perdas?from=2000-01-01&to=2099-12-31`);
    assert.ok(losses.rows.length >= 2);

    // ---- movimentações são imutáveis; relatórios exportam
    const mov = await call('GET', '/api/admin/movements');
    assert.ok(mov.length > 5);
    for (const t of ['vendas', 'mais_vendidos', 'maior_faturamento', 'margem', 'despesas', 'compras', 'estoque', 'perdas', 'lucro', 'delivery', 'presencial']) {
      const r = await call('GET', `/api/admin/reports/${t}?from=2000-01-01&to=2099-12-31`);
      assert.ok(Array.isArray(r.rows), t);
    }
    const pdf = await call('GET', '/api/admin/reports/vendas?format=pdf', null, { raw: true });
    assert.strictEqual(pdf.headers.get('content-type'), 'application/pdf');
    assert.strictEqual((await pdf.arrayBuffer()).byteLength > 1000, true);
    const xlsx = await call('GET', '/api/admin/reports/lucro?format=xlsx', null, { raw: true });
    assert.ok(xlsx.headers.get('content-type').includes('spreadsheet'));

    // ---- permissões
    await call('POST', '/api/admin/users', { name: 'Atendente Teste', username: 'atend', password: 'senhaForte2', role: 'attendant' });
    await call('POST', '/api/auth/logout', {}); cookie = '';
    await call('POST', '/api/auth/login', { username: 'atend', password: 'senhaForte2' });
    await call('GET', '/api/admin/orders');
    await expectFail(call('GET', '/api/admin/finance'), 403);
    await expectFail(call('GET', '/api/admin/dashboard'), 403);
    await expectFail(call('POST', '/api/admin/movements', { item_id: acai, direction: 'out', reason: 'perda', quantity: 1, note: 'x' }), 403);
    await call('POST', '/api/auth/login', { username: 'dona', password: 'senhaForte1' });
    const audit = await call('GET', '/api/admin/audit');
    assert.ok(audit.some(a => a.action === 'order.status'));
    const bk = await call('GET', '/api/admin/backup.json');
    assert.ok(bk.tables.orders.length >= 3 && !('password_hash' in bk.tables.users[0]));
    await expectFail(call('POST', '/api/auth/login', { username: 'dona', password: 'errada' }), 401);

    console.log('✔ Todos os testes passaram');
  } catch (e) {
    console.error('✘ FALHOU:', e.stack || e.message); process.exitCode = 1;
  } finally {
    srv.kill(); fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
