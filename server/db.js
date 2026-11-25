// Banco de dados: libSQL/SQLite.
//  - Em produção (Vercel): banco Turso na nuvem (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
//  - No computador: arquivo local data/supremo.db.
// Todos os valores em dinheiro são armazenados em CENTAVOS (inteiros).
// Horários são gravados no horário da Bahia (UTC−3, sem horário de verão).
process.env.TZ = process.env.TZ || 'America/Bahia';
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
// limpa espaços/aspas que às vezes vêm junto ao colar as variáveis na Vercel
const envClean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
// aceita também nomes com prefixo criados pela integração da Vercel (ex.: STORAGE_TURSO_DATABASE_URL)
const findEnv = (...suffixes) => {
  for (const sfx of suffixes) {
    if (process.env[sfx]) return process.env[sfx];
    const k = Object.keys(process.env).find(x => x.endsWith('_' + sfx) && process.env[x]);
    if (k) return process.env[k];
  }
  return '';
};
const TURSO_URL = envClean(findEnv('TURSO_DATABASE_URL', 'TURSO_URL', 'LIBSQL_URL')).replace(/^https:\/\//, 'libsql://');
const TURSO_TOKEN = envClean(findEnv('TURSO_AUTH_TOKEN', 'TURSO_TOKEN', 'LIBSQL_AUTH_TOKEN'));
const REMOTE = Boolean(TURSO_URL);
const ON_VERCEL = Boolean(process.env.VERCEL);
// Na Vercel não há disco permanente: sem o Turso configurado o banco não funciona.
const CONFIG_ERROR = ON_VERCEL && !REMOTE
  ? 'Banco de dados não configurado: cadastre TURSO_DATABASE_URL e TURSO_AUTH_TOKEN em Settings › Environment Variables na Vercel e faça Redeploy.'
  : (REMOTE && !TURSO_TOKEN ? 'Falta a variável TURSO_AUTH_TOKEN (token do banco Turso) na Vercel.' : null);
let client;
if (!CONFIG_ERROR) {
  // Na nuvem usa o cliente HTTP (sem binários nativos); no computador, o arquivo local.
  const { createClient } = REMOTE ? require('@libsql/client/web') : require('@libsql/client');
  if (!REMOTE) fs.mkdirSync(DATA_DIR, { recursive: true });
  client = createClient(REMOTE ? { url: TURSO_URL, authToken: TURSO_TOKEN } : { url: 'file:' + path.join(DATA_DIR, 'supremo.db') });
}

// Transação atual (cada requisição dentro de tx() usa a mesma transação)
const txStore = new AsyncLocalStorage();
const exec = () => txStore.getStore() || client;
const clean = (args) => args.map(a => a === undefined ? null : (typeof a === 'boolean' ? (a ? 1 : 0) : a));
const toObj = (rs) => rs.rows.map(r => { const o = {}; rs.columns.forEach((c, i) => { o[c] = r[i]; }); return o; });

// API parecida com a anterior: db.prepare(sql).get/all/run(...) — agora assíncrona (use await)
const db = {
  prepare(sql) {
    return {
      async get(...args) { const rs = await exec().execute({ sql, args: clean(args) }); return toObj(rs)[0]; },
      async all(...args) { return toObj(await exec().execute({ sql, args: clean(args) })); },
      async run(...args) {
        const rs = await exec().execute({ sql, args: clean(args) });
        return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null };
      }
    };
  },
  async exec(sql) { return exec().executeMultiple(sql); },
  // vários comandos de uma vez, tudo ou nada
  // em blocos, dentro de uma única transação (tudo ou nada)
  async batch(stmts) {
    const list = stmts.map(x => ({ sql: x.sql, args: clean(x.args || []) }));
    const t = await client.transaction('write');
    try {
      for (let i = 0; i < list.length; i += 150) await t.batch(list.slice(i, i + 150));
      await t.commit();
    } catch (e) { try { await t.rollback(); } catch { /* ignore */ } throw e; } finally { t.close(); }
  }
};

async function tx(fn) {
  if (txStore.getStore()) return fn(); // já dentro de uma transação
  const t = await client.transaction('write');
  try {
    const r = await txStore.run(t, fn);
    await t.commit();
    return r;
  } catch (e) {
    try { await t.rollback(); } catch { /* ignore */ }
    throw e;
  } finally { t.close(); }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','attendant','stockist')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  price INTEGER NOT NULL DEFAULT 0,          -- usado quando o produto não tem tamanhos
  active INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,       -- "mais vendidos / destaques" na home
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

CREATE TABLE IF NOT EXISTS product_sizes (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS addon_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  min_select INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 0,      -- 0 = sem limite
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS addons (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_addon_groups (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, group_id)
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','fixed')),
  discount_value INTEGER NOT NULL DEFAULT 0,  -- percent (0-100) ou centavos
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                  -- identificador público (link de acompanhamento)
  channel TEXT NOT NULL DEFAULT 'online' CHECK (channel IN ('online','balcao')),
  mode TEXT NOT NULL CHECK (mode IN ('delivery','pickup','local')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  address_ref TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix','cash','credit','debit')),
  change_for INTEGER,                          -- troco para (centavos)
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  payment_provider TEXT,
  payment_ref TEXT,
  payment_confirmed_by TEXT,                   -- 'provider' ou nome do usuário que conferiu
  notes TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  cost_estimate INTEGER NOT NULL DEFAULT 0,    -- custo estimado (fichas técnicas) no momento da baixa
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','confirmed','preparing','out_for_delivery','delivered','rejected','cancelled')),
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  sale_registered INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  size_id INTEGER,
  product_name TEXT NOT NULL,
  category_name TEXT NOT NULL DEFAULT '',
  size_name TEXT,
  unit_price INTEGER NOT NULL,                 -- preço do produto + adicionais (por unidade)
  quantity INTEGER NOT NULL,
  addons TEXT NOT NULL DEFAULT '[]',           -- JSON [{id,name,price}]
  notes TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  user_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  products TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Ingredientes',
  unit TEXT NOT NULL,                          -- kg, g, l, ml, un ...
  quantity REAL NOT NULL DEFAULT 0,
  min_quantity REAL NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0,        -- custo por unidade de medida (centavos, média ponderada)
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  last_entry_at TEXT,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

-- Movimentações são IMUTÁVEIS: correções são feitas com novos lançamentos de ajuste.
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES stock_items(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  reason TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  total_value INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  order_id INTEGER REFERENCES orders(id),
  purchase_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  balance_after REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);
CREATE INDEX IF NOT EXISTS idx_mov_item ON stock_movements(item_id, created_at);
CREATE TRIGGER IF NOT EXISTS trg_mov_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'Movimentações de estoque não podem ser alteradas'); END;
CREATE TRIGGER IF NOT EXISTS trg_mov_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'Movimentações de estoque não podem ser apagadas'); END;

-- Ficha técnica: ingredientes consumidos por produto (opcionalmente por tamanho) e por adicional
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  size_id INTEGER REFERENCES product_sizes(id) ON DELETE CASCADE,
  addon_id INTEGER REFERENCES addons(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  quantity REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','cancelled')),
  total INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  invoice TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  received_at TEXT,
  received_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  quantity REAL NOT NULL,
  unit_cost INTEGER NOT NULL,
  expires_at TEXT
);

-- Lançamentos financeiros (receitas e despesas / contas a pagar)
CREATE TABLE IF NOT EXISTS finance_entries (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  competence_date TEXT NOT NULL,               -- data de competência
  due_date TEXT,
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  payment_method TEXT,
  order_id INTEGER REFERENCES orders(id),
  purchase_id INTEGER REFERENCES purchases(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  user_id INTEGER REFERENCES users(id),
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);
CREATE INDEX IF NOT EXISTS idx_fin_comp ON finance_entries(competence_date);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id INTEGER PRIMARY KEY,
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours')),
  opening_amount INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  expected TEXT,                               -- JSON por forma de pagamento
  counted TEXT,                                -- JSON por forma de pagamento
  difference INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('sale','extra_in','withdrawal','sangria')),
  method TEXT NOT NULL DEFAULT 'cash',
  amount INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_id INTEGER REFERENCES orders(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','-3 hours'))
);
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Registro de auditoria é somente leitura'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Registro de auditoria é somente leitura'); END;
`;

// Cria as tabelas (uma vez por processo)
let initPromise = null;
function init() {
  if (!initPromise) initPromise = (async () => {
    if (CONFIG_ERROR) { const e = new Error(CONFIG_ERROR); e.status = 503; e.expose = true; throw e; }
    if (!REMOTE) await client.execute('PRAGMA foreign_keys = ON');
    await client.executeMultiple(SCHEMA);
  })().catch(e => { initPromise = null; throw e; });
  return initPromise;
}

// ---------- Configurações padrão ----------
const DEFAULT_SETTINGS = {
  store_name: 'SUPREMO AÇAÍ E PETISCARIA',
  slogan: 'O MELHOR AÇAÍ E PETISCOS DA REGIÃO!',
  address: 'Rua Oceano Atlântico, Nº 04, Madre de Deus – BA',
  city: 'Madre de Deus',
  state: 'BA',
  whatsapp: '5571992713438',
  whatsapp_display: '(71) 99271-3438',
  service_info: 'Delivery e atendimento presencial',
  opening_hours: 'Das 16h às 23h',
  open_time: '16:00',           // pedidos online só são aceitos neste horário
  close_time: '23:00',
  store_open: true,
  delivery_enabled: true,
  pickup_enabled: true,
  delivery_fee: 500,            // R$ 5,00
  min_order: 0,
  // Identidade oficial (logo e fotos enviadas pela proprietária). Podem ser trocadas no painel.
  logo: '/img/logo-supremo.png',
  hero_images: ['/img/costela.jpg', '/img/salgados.jpg', '/img/torta-de-frango.jpg'],
  brand_colors: { primary: '#13a49c', dark: '#0b5e59', accent: '#e38340', accent_text: '#2b1606', background: '#f7f1e6' },
  payments: {
    pix: { enabled: true, on_site: true, key: '', key_type: '', receiver_name: '', receiver_city: 'MADRE DE DEUS', instructions: '' },
    cash: { enabled: true },
    credit: { enabled: true },
    debit: { enabled: true },
    online: { provider: 'none' } // 'mercadopago' quando credenciais estiverem no servidor
  },
  expiry_alert_days: 7,
  bills_alert_days: 3,
  card_fee_percent: { credit: 0, debit: 0 }
};

async function getSetting(key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULT_SETTINGS[key];
  try { return JSON.parse(row.value); } catch { return DEFAULT_SETTINGS[key]; }
}
async function setSetting(key, value) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
async function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of await db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignora */ }
  }
  out.payments = { ...DEFAULT_SETTINGS.payments, ...(out.payments || {}) };
  return out;
}

async function audit(user, action, entity, entityId, details, ip) {
  await db.prepare('INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?)')
    .run(user ? user.id : null, user ? user.name : 'sistema', action, entity, entityId ?? null,
      details ? JSON.stringify(details) : null, ip || null);
}

// ---------- Cópia de segurança ----------
// Exporta todas as tabelas em um arquivo JSON (funciona no Turso e no arquivo local).
// O Turso também guarda o histórico do banco automaticamente (restauração por data).
const TABLES = ['settings', 'users', 'categories', 'products', 'product_sizes', 'addon_groups', 'addons', 'product_addon_groups',
  'promotions', 'orders', 'order_items', 'order_status_history', 'suppliers', 'stock_items', 'stock_movements', 'recipes',
  'purchases', 'purchase_items', 'finance_entries', 'cash_sessions', 'cash_movements', 'audit_log'];
async function exportAll() {
  const out = { generated_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const rows = await db.prepare(`SELECT * FROM ${t}`).all();
    out.tables[t] = t === 'users' ? rows.map(({ password_hash, ...u }) => u) : rows;
  }
  return out;
}

module.exports = { CONFIG_ERROR, ON_VERCEL, TURSO_URL, TURSO_TOKEN, db, tx, init, getSetting, setSetting, allSettings, audit, exportAll, DATA_DIR, REMOTE, DEFAULT_SETTINGS };
