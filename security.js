// ============================================================
// security.js — Rate limit, HMAC tokens, CSRF, Path guard
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_FILE = path.join(__dirname, 'security.log');

// ─── Simple logger ─────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `${ts} [${level}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch (_) {}
  if (level === 'ERROR') console.error(line.trim());
}

const logger = {
  info:  (m) => log('INFO',  m),
  warn:  (m) => log('WARNING', m),
  error: (m) => log('ERROR', m),
};

// ─── RateLimiter ───────────────────────────────────────────
class RateLimiter {
  constructor(requests = 60, window = 60) {
    this.requests = requests;
    this.window = window;
    this._hits = new Map();
  }
  check(key) {
    const now = Date.now() / 1000;
    if (!this._hits.has(key)) this._hits.set(key, []);
    const q = this._hits.get(key);
    while (q.length && now - q[0] > this.window) q.shift();
    if (q.length >= this.requests) {
      logger.warn(`RATE_LIMIT key=${key} hits=${q.length}`);
      return false;
    }
    q.push(now);
    return true;
  }
}

// ─── LoginTokens (HMAC) ────────────────────────────────────
class LoginTokens {
  constructor(secret, lifetimeHours = 12) {
    this.secret = secret;
    this.lifetime = lifetimeHours * 3600;
  }
  _fingerprint(ip, ua) {
    const raw = `${ip}|${(ua || '').slice(0, 120)}`;
    return crypto.createHmac('sha256', this.secret).update(raw).digest('hex').slice(0, 16);
  }
  issue(user = 'admin', ip = '', ua = '') {
    const expires = Math.floor(Date.now() / 1000) + this.lifetime;
    const nonce = crypto.randomBytes(8).toString('hex');
    const fp = this._fingerprint(ip, ua);
    const msg = `${user}:${expires}:${nonce}:${fp}`;
    const sig = crypto.createHmac('sha256', this.secret).update(msg).digest('hex').slice(0, 32);
    return `${msg}:${sig}`;
  }
  verify(token, ip = '', ua = '') {
    if (!token) return null;
    const parts = token.split(':');
    if (parts.length !== 5) return null;
    const [user, expiresS, nonce, fp, sig] = parts;
    const expires = parseInt(expiresS, 10);
    if (!expires || Date.now() / 1000 > expires) return null;
    const msg = `${user}:${expiresS}:${nonce}:${fp}`;
    const expected = crypto.createHmac('sha256', this.secret).update(msg).digest('hex').slice(0, 32);
    if (!timingSafeEqualHex(sig, expected)) {
      logger.warn(`TOKEN_TAMPERED user=${user}`);
      return null;
    }
    if (!timingSafeEqualHex(fp, this._fingerprint(ip, ua))) {
      logger.warn(`TOKEN_FP_MISMATCH user=${user} ip=${ip}`);
      return null;
    }
    return user;
  }
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (_) {
    return false;
  }
}

// ─── CSRF ──────────────────────────────────────────────────
class CSRFTokens {
  constructor(_secret) {}
  issue() {
    return crypto.randomBytes(32).toString('base64url');
  }
  verify(token, sessionToken) {
    if (!token || !sessionToken) return false;
    return timingSafeEqualHex(token, sessionToken);
  }
}

// ─── Path guard ────────────────────────────────────────────
const DANGEROUS = new Set([
  '.git', '.env', '.ssh', 'id_rsa', 'id_ed25519',
  'authorized_keys', '.bashrc', '.profile', '.zshrc',
  'sudoers', '.aws', 'shadow', 'passwd',
]);

function safeJoin(base, userPath) {
  if (!userPath) throw new Error('path ว่าง');
  userPath = String(userPath).replace(/\x00/g, '').trim();

  if (userPath.startsWith('/') || userPath.startsWith('\\'))
    throw new Error('ห้าม absolute path');
  if (userPath.length >= 2 && userPath[1] === ':')
    throw new Error('ห้าม absolute path (Windows)');
  if (userPath.startsWith('~'))
    throw new Error('ห้ามใช้ home expansion');
  if (userPath.startsWith('\\\\') || userPath.startsWith('//'))
    throw new Error('ห้าม UNC path');

  const parts = userPath.replace(/\\/g, '/').split('/');
  if (parts.includes('..')) throw new Error('ห้ามใช้ ..');
  for (const p of parts) {
    if (DANGEROUS.has(p)) throw new Error(`ห้ามเข้าถึง: ${p}`);
  }

  const baseResolved = path.resolve(base);
  const target = path.resolve(baseResolved, userPath);

  const rel = path.relative(baseResolved, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path ออกนอกโฟลเดอร์ที่อนุญาต');
  }
  return target;
}

function isSubpath(child, parent) {
  try {
    const c = path.resolve(child);
    const p = path.resolve(parent);
    const rel = path.relative(p, c);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch (_) {
    return false;
  }
}

// ─── Validation ────────────────────────────────────────────
function validateText(s, maxLen = 200_000, name = 'text') {
  if (typeof s !== 'string') throw new Error(`${name} ต้องเป็น string`);
  s = s.replace(/\x00/g, '');
  if (s.length > maxLen) throw new Error(`${name} ยาวเกิน ${maxLen}`);
  return s;
}

function validateFloat(v, minV = null, maxV = null, name = 'value') {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} ต้องเป็นตัวเลข`);
  if (minV !== null && n < minV) throw new Error(`${name} ต่ำเกิน`);
  if (maxV !== null && n > maxV) throw new Error(`${name} สูงเกิน`);
  return n;
}

function logSuspicious(req, reason) {
  const ip = req.ip || req.socket?.remoteAddress || '?';
  const ua = String(req.headers['user-agent'] || '?').slice(0, 120);
  logger.warn(`SUSPICIOUS [${reason}] ${req.method} ${req.path} ip=${ip} ua=${ua}`);
}

module.exports = {
  logger,
  RateLimiter,
  LoginTokens,
  CSRFTokens,
  safeJoin,
  isSubpath,
  validateText,
  validateFloat,
  logSuspicious,
  timingSafeEqualHex,
};