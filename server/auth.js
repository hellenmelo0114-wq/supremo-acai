const crypto = require('crypto');
const { db } = require('./db');

// ---------- Permissões por perfil ----------
// Para mudar o que cada perfil acessa, altere apenas este mapa.
const ROLE_LABELS = { owner: 'Proprietária', manager: 'Gerente', attendant: 'Atendente', stockist: 'Estoquista' };
const PERMISSIONS = {
  owner: ['*'],
  manager: ['dashboard', 'orders', 'products', 'stock', 'movements', 'recipes', 'suppliers', 'purchases', 'cash', 'reports.operational'],
  attendant: ['orders'],
  stockist: ['stock', 'movements']
};
function can(user, perm) {
  if (!user) return false;
  const list = PERMISSIONS[user.role] || [];
  return list.includes('*') || list.includes(perm);
}

// ---------- Senhas (scrypt) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}
function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'A senha deve conter letras e números.';
  return null;
}

// ---------- Sessões ----------
const COOKIE = 'supremo_sess';
const SESSION_HOURS = 12;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, expires);
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return token;
}
async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
async function userFromRequest(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = await db.prepare(`SELECT u.id, u.name, u.username, u.role, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(token));
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  return { id: row.id, name: row.name, username: row.username, role: row.role };
}
function setSessionCookie(res, token, req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
}

// ---------- Limite de tentativas de login ----------
const attempts = new Map();
function loginAllowed(key) {
  const a = attempts.get(key);
  if (!a) return true;
  if (a.until && a.until > Date.now()) return false;
  return true;
}
function loginFailed(key) {
  const a = attempts.get(key) || { n: 0 };
  a.n += 1;
  if (a.n >= 5) { a.until = Date.now() + 15 * 60e3; a.n = 0; }
  attempts.set(key, a);
}
function loginOk(key) { attempts.delete(key); }

// ---------- Middlewares ----------
async function requireAuth(req, res, next) {
  let user;
  try { user = await userFromRequest(req); } catch (e) { return next(e); }
  if (!user) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.user = user;
  next();
}
function requirePerm(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
    if (!perms.some(p => can(req.user, p))) return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
    next();
  };
}

module.exports = {
  ROLE_LABELS, PERMISSIONS, can, hashPassword, verifyPassword, validatePassword,
  createSession, destroySession, parseCookies, userFromRequest, setSessionCookie, clearSessionCookie,
  loginAllowed, loginFailed, loginOk, requireAuth, requirePerm, COOKIE
};
