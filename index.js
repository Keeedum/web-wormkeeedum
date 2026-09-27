// ============================================================
// server.js — Keeedum AI (Node.js Edition) — HOST EDITION v2
// ============================================================
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const axios = require('axios');

// ─── Local modules ────────────────────────────────────────
const security = require('./security');
const { logger, RateLimiter, LoginTokens, CSRFTokens,
        safeJoin, isSubpath, validateText, validateFloat,
        logSuspicious } = security;
const mailTools = require('./mail-tools');
const mailer = require('./mailer');
const verify = require('./verify');
const db = require('./db');
const account = require('./account');

// ★ OTP: ดึง sendOtp จาก otpSender (ห้ามประกาศซ้ำในไฟล์นี้)
const { sendOtp } = require('./otpSender');
const proxyLoader = require('./proxyLoader');

let userdb = null, subs = null;
try { userdb = require('./users');           var HAS_USERS = true;  }
catch (e) { console.log(`⚠️  ไม่มี users.js: ${e.message}`); var HAS_USERS = false; }

try { subs = require('./subscriptions');     var HAS_SUBS = true;   }
catch (e) { console.log(`⚠️  ไม่มี subscriptions.js: ${e.message}`); var HAS_SUBS = false; }

const walletdb = require('./wallet');
const tmn = require('./truemoney');
const daily = require('./daily_reward');

// ─── Paths & constants ────────────────────────────────────
const BASE = __dirname;
const PROMPT_FILE   = path.join(BASE, 'prompt.txt');
const PERSONAS_FILE = path.join(BASE, 'personas.txt');
const CFG_FILE      = path.join(BASE, 'config.json');
const SECRET_FILE   = path.join(BASE, '.secret_key');

const PROJECTS_DIR = path.join(os.homedir(), 'Desktop', 'AIProjects');
try { fs.mkdirSync(PROJECTS_DIR, { recursive: true }); } catch (_) {}

// ─── Env / config ─────────────────────────────────────────
const API_BASE = (process.env.API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const API_KEY  = (process.env.API_KEY || '').trim();
const API_URL  = `${API_BASE}/chat/completions`;
const IS_OPENROUTER = API_BASE.toLowerCase().includes('openrouter.ai');
const APP_URL   = (process.env.APP_URL   || 'http://localhost').trim();
const APP_TITLE = (process.env.APP_TITLE || 'Keeedum AI').trim();

const API_TIMEOUT_CONNECT = parseInt(process.env.API_TIMEOUT_CONNECT || '15000', 10);
const API_TIMEOUT_READ    = parseInt(process.env.API_TIMEOUT_READ    || '1800000', 10);

// ★ HOST: bind 0.0.0.0 ให้คนนอกเข้าได้
const WEB_HOST = process.env.AI_WEB_HOST || '0.0.0.0';
const WEB_PORT = parseInt(process.env.AI_WEB_PORT || process.env.PORT || '3000', 10);

const MAX_CONTENT  = parseInt(process.env.MAX_CONTENT_LENGTH || '10485760', 10);
const RATE_N       = parseInt(process.env.RATE_LIMIT_REQUESTS || '60', 10);
const RATE_W       = parseInt(process.env.RATE_LIMIT_WINDOW   || '60', 10);
const LOGIN_RATE_N = parseInt(process.env.LOGIN_RATE_LIMIT    || '5', 10);
const SESSION_H    = parseInt(process.env.SESSION_HOURS       || '12', 10);

// ★ HOST: production mode
const NODE_ENV     = (process.env.NODE_ENV || 'development').toLowerCase();
const IS_PROD      = NODE_ENV === 'production';


// ★ แปลง TRUST_PROXY ให้รองรับ: true | false | ตัวเลข | IP/CIDR
function parseTrustProxy(v) {
  if (v === undefined || v === null || v === '') return 1;
  const s = String(v).trim().toLowerCase();
  if (s === 'true'  || s === '1' || s === 'yes' || s === 'on')  return true;
  if (s === 'false' || s === '0' || s === 'no'  || s === 'off') return false;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return String(v).trim();
}
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

const ALLOW_REGISTER = ['1','true','yes'].includes(
  String(process.env.ALLOW_REGISTER || 'true').toLowerCase()
);
const DEFAULT_ADMIN_USER  = (process.env.DEFAULT_ADMIN_USER  || 'admin').trim();
const DEFAULT_ADMIN_PASS  = (process.env.DEFAULT_ADMIN_PASS  || 'admin123').trim();
const DEFAULT_ADMIN_EMAIL = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@localhost').trim().toLowerCase();
const SUBSCRIPTION_ENABLED = ['1','true','yes'].includes(
  String(process.env.SUBSCRIPTION_ENABLED || 'true').toLowerCase()
);
const ADMIN_USER    = DEFAULT_ADMIN_USER;
const PAYMENT_PHONE = (process.env.PAYMENT_PHONE || '0953167272').trim();
const PAYMENT_NAME  = (process.env.PAYMENT_NAME  || 'Keeedum AI').trim();

// ★ HOST: sameSite / secure ยืดหยุ่นผ่าน env
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
const FORCE_HTTPS     = ['1','true','yes'].includes(
  String(process.env.FORCE_HTTPS || (IS_PROD ? 'true' : 'false')).toLowerCase()
);


// ★ EMAIL VERIFY
const ENABLE_EMAIL_VERIFY = ['1','true','yes'].includes(
  String(process.env.ENABLE_EMAIL_VERIFY || 'true').toLowerCase()
);
const VERIFY_REQUIRED     = ['1','true','yes'].includes(
  String(process.env.VERIFY_REQUIRED || 'true').toLowerCase()
);
const VERIFY_TTL          = parseInt(process.env.VERIFY_TOKEN_TTL || '3600', 10);
const VERIFY_RESEND_CD    = parseInt(process.env.VERIFY_RESEND_COOLDOWN || '60', 10);
const VERIFY_RESEND_MAX   = parseInt(process.env.VERIFY_MAX_PER_DAY || '5', 10);

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
];

// ─── Allowed folders ──────────────────────────────────────
const ALLOWED_ROOTS = [];
const envRoots = (process.env.ALLOWED_FOLDERS || '').trim();
if (envRoots) {
  for (const r of envRoots.split(',')) {
    const t = r.trim();
    if (!t) continue;
    try {
      const p = path.resolve(t.replace(/^~/, os.homedir()));
      fs.mkdirSync(p, { recursive: true });
      ALLOWED_ROOTS.push(p);
    } catch (e) {
      console.log(`⚠️  ใช้โฟลเดอร์ ${t} ไม่ได้: ${e.message}`);
    }
  }
}
if (!ALLOWED_ROOTS.length) ALLOWED_ROOTS.push(path.resolve(PROJECTS_DIR));

// ─── Secret key ───────────────────────────────────────────
function loadSecret() {
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE);
  const key = crypto.randomBytes(48);
  fs.writeFileSync(SECRET_FILE, key);
  try { fs.chmodSync(SECRET_FILE, 0o600); } catch (_) {}
  return key;
}
const SECRET_KEY = loadSecret();

// ─── Prompt loader ────────────────────────────────────────
function ensurePromptFile() {
  if (fs.existsSync(PROMPT_FILE)) return;
  try {
    fs.writeFileSync(PROMPT_FILE, '', 'utf8');
    console.log(`[INIT] ✅ สร้าง prompt.txt เริ่มต้นแล้วที่ ${PROMPT_FILE}`);
  } catch (e) {
    console.log(`[INIT] ⚠️ สร้าง prompt.txt ไม่ได้: ${e.message}`);
  }
}

function loadPromptTxt(forceReload = true) {
  if (!fs.existsSync(PROMPT_FILE)) ensurePromptFile();
  try {
    const prompt = fs.readFileSync(PROMPT_FILE, 'utf8').trim();
    if (!prompt) {
      logger.warn('prompt.txt ว่าง');
      return '';
    }
    logger.info(`PROMPT_LOADED chars=${prompt.length} path=${PROMPT_FILE}`);
    return prompt;
  } catch (e) {
    logger.error(`อ่าน prompt.txt ไม่ได้: ${e.message}`);
    return '';
  }
}

// ─── AI core ──────────────────────────────────────────────
function buildHeaders(fip = '127.0.0.1') {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
  };
  if (IS_OPENROUTER) {
    headers['HTTP-Referer'] = APP_URL;
    headers['X-Title'] = APP_TITLE;
  } else {
    headers['X-Forwarded-For'] = String(fip);
  }
  return headers;
}

async function openaiChatRaw(prompt, opts = {}) {
  const {
    model = 'gpt-3.5-turbo',
    pay = '',
    fip = '127.0.0.1',
    systemPrompt = '',
    maxTokensRange = [850, 1050],
    temperature = 0.0,
    timeout = 120_000,
  } = opts;

  if (!API_KEY) {
    return { ok: false, content: '', error: 'ไม่ตั้ง API_KEY', raw: {} };
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
    logger.info(`SYSTEM_PROMPT_ATTACHED chars=${systemPrompt.length}`);
  }
  const userContent = pay ? `\n\n ${pay}, Question: ${prompt}` : `\n\n${prompt}`;
  messages.push({ role: 'user', content: userContent });

  const maxTokens = Math.floor(
    maxTokensRange[0] + Math.random() * (maxTokensRange[1] - maxTokensRange[0] + 1)
  );

  try {
    const resp = await axios.post(API_URL, {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }, {
      headers: buildHeaders(fip),
      timeout,
      validateStatus: () => true,
      proxy: false,
    });

    const status = resp.status;
    const data = resp.data || {};

    if (status !== 200) {
      let err = data.error || data;
      if (typeof err === 'object' && err.message) err = err.message;
      return { ok: false, content: '', error: `HTTP ${status}: ${String(err).slice(0, 300)}`, raw: {} };
    }

    if (data.error) {
      const err = data.error.message || String(data.error);
      return { ok: false, content: '', error: String(err), raw: data };
    }

    const content = (data.choices?.[0]?.message?.content) || '';
    return { ok: true, content, error: null, raw: data };

  } catch (e) {
    if (e.code === 'ECONNABORTED') {
      return { ok: false, content: '', error: 'timeout', raw: {} };
    }
    if (e.code === 'ECONNREFUSED') {
      return { ok: false, content: '', error: `เชื่อมต่อ ${API_BASE} ไม่ได้`, raw: {} };
    }
    return { ok: false, content: '', error: String(e.message).slice(0, 300), raw: {} };
  }
}

// ─── Express setup ────────────────────────────────────────
const app = express();

// ★ HOST: trust proxy — ต้องตั้งก่อน middleware ที่อ่าน req.ip
app.set('trust proxy', TRUST_PROXY);

app.set('view engine', 'ejs');
app.set('views', path.join(BASE, 'templates'));
app.use('/static', express.static(path.join(BASE, 'static')));
app.use(express.json({ limit: MAX_CONTENT }));
app.use(express.urlencoded({ extended: true, limit: MAX_CONTENT }));
app.use(cookieParser());

// ★ HOST: helper ตรวจ HTTPS จาก proxy header
function isHttps(req) {
  return Boolean(
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    req.headers['x-forwarded-ssl'] === 'on' ||
    (req.headers['cf-visitor'] && String(req.headers['cf-visitor']).includes('https'))
  );
}

// ★ HOST: session config ปรับให้ทำงานกับ HTTPS + Proxy
app.use(session({
  name: 'keeedum.sid',
  secret: SECRET_KEY.toString('hex'),
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: 'auto',
    maxAge: SESSION_H * 3600 * 1000,
    path: '/',
  },
}));

// ★ HOST: บังคับ HTTPS เมื่ออยู่หลัง proxy (เฉพาะเมื่อ FORCE_HTTPS=true)
if (FORCE_HTTPS) {
  app.use((req, res, next) => {
    if (req.path === '/health' || req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
      return next();
    }
    if (!isHttps(req)) {
      const host = req.headers.host || `localhost:${WEB_PORT}`;
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
    next();
  });
}

// ─── Helpers ──────────────────────────────────────────────
const userTokens   = new LoginTokens(SECRET_KEY, SESSION_H);
const csrfTokens   = new CSRFTokens(SECRET_KEY);
const rateLimiter  = new RateLimiter(RATE_N, RATE_W);
const loginLimiter = new RateLimiter(LOGIN_RATE_N, 60);

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '?';
}
function getUa(req) {
  return req.headers['user-agent'] || '';
}
function currentUser(req) {
  const token = req.session?.user_token;
  if (!token) return null;
  return userTokens.verify(token, clientIp(req), getUa(req));
}
function isCurrentAdmin(req) {
  return currentUser(req) === DEFAULT_ADMIN_USER;
}
function ensureCsrf(req) {
  if (!req.session.csrf) req.session.csrf = csrfTokens.issue();
  return req.session.csrf;
}

// ============================================================
// PERSONA LOADER
// ============================================================
function loadPersonas() {
  if (!fs.existsSync(PROMPT_FILE)) {
    try { fs.writeFileSync(PROMPT_FILE, '', 'utf8'); } catch (_) {}
  }

  const out = {};
  let text = '';
  try {
    text = fs.readFileSync(PROMPT_FILE, 'utf8');
  } catch (_) {
    return { 'ปกติ': '' };
  }

  if (!text.trim()) return { 'ปกติ': '' };

  const hasEqFormat = /^===.*?===\s*$/m.test(text);

  if (hasEqFormat) {
    const re = /^===\s*(.+?)\s*===\s*$([\s\S]*?)(?=^===\s*.+?\s*===\s*$|$)/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      const body = (m[2] || '').trim();
      if (name) out[name] = body;
    }
  } else {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('|')) continue;
      const idx = line.indexOf('|');
      const name = line.slice(0, idx).trim();
      const body = line.slice(idx + 1).trim();
      if (name) out[name] = body;
    }
  }

  if (Object.keys(out).length === 0) out['ปกติ'] = '';
  return out;
}

function loadCfg() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); }
  catch (_) { return {}; }
}
function saveCfg(d) {
  try { fs.writeFileSync(CFG_FILE, JSON.stringify(d, null, 2), 'utf8'); }
  catch (_) {}
}

const CODE_EXTS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.md', '.txt',
  '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.sh',
  '.yml', '.yaml', '.toml', '.ini', '.xml', '.sql', '.vue', '.svelte',
]);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  '.idea', '.vscode', '.next', 'target', 'bin', 'obj', '.cache',
]);

function walkDir(root, cb, opts = {}) {
  const { maxFiles = 100, skipDirs = SKIP_DIRS } = opts;
  let count = 0;
  const stack = [root];
  while (stack.length && count < maxFiles) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name) || ent.name.startsWith('.')) continue;
        stack.push(full);
      } else if (ent.isFile()) {
        if (cb(full) === false) return;
        if (++count >= maxFiles) return;
      }
    }
  }
}

function readProjectFiles(root, maxFiles = 20, maxSize = 8000) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  walkDir(root, (p) => {
    if (files.length >= maxFiles) return false;
    const ext = path.extname(p).toLowerCase();
    if (!CODE_EXTS.has(ext)) return;
    try {
      const st = fs.statSync(p);
      if (st.size > 200_000) return;
      let txt = fs.readFileSync(p, 'utf8');
      if (txt.length > maxSize) txt = txt.slice(0, maxSize) + '\n... (ตัดทอน)';
      const rel = path.relative(root, p).replace(/\\/g, '/');
      files.push(`file:${rel}\n${txt}\n`);
    } catch (_) {}
  }, { maxFiles });
  return files;
}

function buildEditContext(root, userMsg) {
  if (!fs.existsSync(root)) return '';
  const tokens = (userMsg.match(/[\w\-./]+\.\w+|[\w\-]+\//g) || []);
  const picked = [];
  const seen = new Set();
  for (const t of tokens) {
    const key = t.replace(/^\/|\/$/g, '');
    if (!key) continue;
    let found = false;
    walkDir(root, (p) => {
      if (found) return false;
      const ext = path.extname(p).toLowerCase();
      if (CODE_EXTS.has(ext) && p.includes(key) && !seen.has(p)) {
        seen.add(p); picked.push(p); found = true;
        return false;
      }
    }, { maxFiles: 500 });
    if (picked.length >= 10) break;
  }
  if (!picked.length) {
    return readProjectFiles(root, 8).join('\n\n');
  }
  const out = [];
  for (const p of picked.slice(0, 10)) {
    try {
      let txt = fs.readFileSync(p, 'utf8');
      if (txt.length > 8000) txt = txt.slice(0, 8000) + '\n... (ตัดทอน)';
      const rel = path.relative(root, p).replace(/\\/g, '/');
      out.push(`file:${rel}\n${txt}\n`);
    } catch (_) {}
  }
  return out.join('\n\n');
}

function getSafeFolder(userFolder) {
  if (!userFolder) return ALLOWED_ROOTS[0];
  let p;
  try { p = path.resolve(String(userFolder).replace(/^~/, os.homedir())); }
  catch (_) { throw new Error('path ไม่ถูกต้อง'); }
  for (const root of ALLOWED_ROOTS) {
    if (isSubpath(p, root)) return p;
  }
  logger.warn(`FOLDER_NOT_ALLOWED ${userFolder}`);
  throw new Error('โฟลเดอร์นี้ไม่อยู่ในรายการที่อนุญาต');
}

function checkRate(req, key = null) {
  const k = key || `ip:${clientIp(req)}`;
  if (!rateLimiter.check(k)) {
    logSuspicious(req, 'RATE_LIMIT');
    const err = new Error('RATE_LIMIT');
    err.status = 429;
    throw err;
  }
}

// ─── Middleware ───────────────────────────────────────────
const VERIFY_BYPASS = new Set([
  '/verify',
  '/verify-pending',
  '/logout',
  '/api/me',
  '/api/verify/resend',
  '/api/verify/status',
]);

function requireLogin(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    logSuspicious(req, 'NO_TOKEN');
    if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'ต้อง login ก่อน' });
    return res.redirect('/welcome');
  }
  req.user = user;

  // ★ EMAIL VERIFY guard
  if (ENABLE_EMAIL_VERIFY && VERIFY_REQUIRED && user !== DEFAULT_ADMIN_USER) {
    try {
      if (HAS_USERS && userdb.isEmailVerified && !userdb.isEmailVerified(user)) {
        const isBypass = [...VERIFY_BYPASS].some(
          (p) => req.path === p || req.path.startsWith(p + '/')
        );
        if (!isBypass) {
          if (req.path.startsWith('/api/')) {
            return res.status(403).json({
              ok: false,
              error: 'ต้องยืนยันอีเมลก่อน',
              need_verify: true,
            });
          }
          return res.redirect('/verify-pending');
        }
      }
    } catch (e) {
      logger.warn(`VERIFY_GUARD_ERR ${e.message}`);
    }
  }

  next();
}

function requireActive(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'ต้อง login' });
    return res.redirect('/login');
  }
  req.user = user;

  if (!SUBSCRIPTION_ENABLED || !HAS_SUBS) return next();
  if (user === DEFAULT_ADMIN_USER) return next();

  if (!subs.isActive(user)) {
    if (req.path.startsWith('/api/'))
      return res.status(402).json({ ok: false, error: 'หมดอายุ', need_buy: true });
    return res.redirect('/buy');
  }
  next();
}

function requireCsrf(req, res, next) {
  if (['POST','PUT','DELETE','PATCH'].includes(req.method)) {
    const token = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
    const sessionToken = req.session?.csrf;
    if (!csrfTokens.verify(token, sessionToken)) {
      logSuspicious(req, 'CSRF_FAIL');
      return res.status(403).json({ ok: false, error: 'CSRF ไม่ถูกต้อง' });
    }
  }
  next();
}

// ─── Security headers ─────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (isHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const connectSrc = ["'self'"];
  if (IS_OPENROUTER) {
    try { connectSrc.push(new URL(API_BASE).origin); } catch (_) {}
  }

  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    `connect-src ${connectSrc.join(' ')}; ` +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
  next();
});

// ─── Init DB + admin ──────────────────────────────────────
walletdb.initDb();
daily.initDb();

if (HAS_USERS) {
  userdb.initDb();
  if (userdb.countUsers() === 0 && DEFAULT_ADMIN_USER && DEFAULT_ADMIN_PASS) {
    const [ok, err] = userdb.createUser(
      DEFAULT_ADMIN_USER,
      DEFAULT_ADMIN_PASS,
      true,
      DEFAULT_ADMIN_EMAIL
    );
    if (ok) {
      console.log(`[INIT] ✅ สร้าง admin '${DEFAULT_ADMIN_USER}' (${DEFAULT_ADMIN_EMAIL})`);
    } else {
      console.log(`[INIT] ⚠️ สร้าง admin ไม่ได้: ${err}`);
    }
  }
}
if (HAS_SUBS) subs.initDb();
ensurePromptFile();

// ─── Auth routes ──────────────────────────────────────────
app.get('/', requireLogin, (req, res) => {
  const user = req.user;
  ensureCsrf(req);
  const isActive = (!SUBSCRIPTION_ENABLED || !HAS_SUBS || user === DEFAULT_ADMIN_USER)
    ? true : subs.isActive(user);
  let claimed = false;
  try { claimed = daily.hasClaimedToday(user); } catch (_) {}
  res.render('index', {
    csrf_token: req.session.csrf,
    is_admin: user === DEFAULT_ADMIN_USER,
    show_daily_popup: !claimed,
    is_active: isActive,
    username: user,
  });
});

app.get('/index', requireLogin, (req, res) => res.redirect('/'));

app.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect('/');

  let success = null;
  let successType = null;

  if (req.query.registered === '1') {
    success = req.query.verify === '1'
      ? 'สมัครสำเร็จ! เราได้ส่งลิงก์ยืนยันไปที่อีเมลของคุณแล้ว'
      : 'สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ';
    successType = 'registered';
  } else if (req.query.verified === '1') {
    success = '✅ ยืนยันอีเมลสำเร็จ! เข้าสู่ระบบได้เลย';
    successType = 'verified';
  } else if (req.query.reset === '1') {
    success = 'รีเซ็ตรหัสผ่านสำเร็จ! เข้าสู่ระบบด้วยรหัสใหม่';
    successType = 'reset';
  }

  res.render('login', {
    error: null,
    success,
    success_type: successType,
    csrf_token: ensureCsrf(req),
    allow_register: ALLOW_REGISTER,
    need_verify: false,
    verify_user: null,
  });
});

app.post('/login', (req, res) => {
  if (!loginLimiter.check(`login:${clientIp(req)}`)) {
    logSuspicious(req, 'LOGIN_RATE_LIMIT');
    return res.status(429).render('login', {
      error: 'ลองมากเกินไป รอ 1 นาที',
      success: null,
      csrf_token: ensureCsrf(req),
      allow_register: ALLOW_REGISTER,
      need_verify: false,
      verify_user: null,
    });
  }

  const id       = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!HAS_USERS) {
    return res.status(500).render('login', {
      error: 'ระบบสมาชิกไม่พร้อมใช้งาน',
      success: null,
      csrf_token: ensureCsrf(req),
      allow_register: false,
      need_verify: false,
      verify_user: null,
    });
  }

  const [ok, err, user] = userdb.verifyUser(id, password);

  if (ok) {
    const realUsername = user.username;

    if (ENABLE_EMAIL_VERIFY && VERIFY_REQUIRED && !user.is_admin && !user.email_verified) {
      logSuspicious(req, `LOGIN_UNVERIFIED user=${realUsername}`);
      return res.status(403).render('login', {
        error: 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ — ตรวจสอบกล่องจดหมายของคุณ',
        success: null,
        csrf_token: ensureCsrf(req),
        allow_register: ALLOW_REGISTER,
        need_verify: true,
        verify_user: realUsername,
      });
    }

    req.session.regenerate((regErr) => {
      if (regErr) return res.status(500).send('session error');

      req.session.user_token = userTokens.issue(realUsername, clientIp(req), getUa(req));
      req.session.username   = realUsername;
      req.session.is_admin   = user.is_admin;
      req.session.csrf       = csrfTokens.issue();

      logger.info(`LOGIN_OK user=${realUsername} ip=${clientIp(req)}`);

      if (SUBSCRIPTION_ENABLED && HAS_SUBS && !user.is_admin) {
        if (!subs.isActive(realUsername)) return res.redirect('/buy');
      }
      res.redirect('/');
    });
    return;
  }

  logSuspicious(req, `LOGIN_FAIL id=${id}`);
  res.status(401).render('login', {
    error: err || 'ชื่อผู้ใช้/อีเมล หรือรหัสผ่านไม่ถูกต้อง',
    success: null,
    csrf_token: ensureCsrf(req),
    allow_register: ALLOW_REGISTER,
    need_verify: false,
    verify_user: null,
  });
});

app.get('/register', (req, res) => {
  if (!ALLOW_REGISTER) {
    return res.status(403).render('register', {
      error: 'ปิดการสมัครสมาชิกชั่วคราว',
      csrf_token: ensureCsrf(req),
      form: {},
    });
  }
  if (!HAS_USERS) {
    return res.status(500).render('register', {
      error: 'ระบบสมาชิกไม่พร้อมใช้งาน',
      csrf_token: ensureCsrf(req),
      form: {},
    });
  }
  res.render('register', {
    error: null,
    csrf_token: ensureCsrf(req),
    form: {},
  });
});

app.post('/register', async (req, res) => {
  if (!ALLOW_REGISTER) {
    return res.status(403).render('register', {
      error: 'ปิดการสมัครสมาชิกชั่วคราว',
      csrf_token: ensureCsrf(req),
      form: {},
    });
  }
  if (!HAS_USERS) {
    return res.status(500).render('register', {
      error: 'ระบบสมาชิกไม่พร้อมใช้งาน',
      csrf_token: ensureCsrf(req),
      form: {},
    });
  }
  if (!loginLimiter.check(`register:${clientIp(req)}`)) {
    logSuspicious(req, 'REGISTER_RATE_LIMIT');
    return res.status(429).render('register', {
      error: 'ลองมากเกินไป รอ 1 นาที',
      csrf_token: ensureCsrf(req),
      form: {},
    });
  }

  const username  = String(req.body.username  || '').trim();
  const email     = String(req.body.email     || '').trim().toLowerCase();
  const password  = String(req.body.password  || '');
  const password2 = String(req.body.password2 || '');

  const formEcho = { username, email };

  if (password !== password2) {
    return res.status(400).render('register', {
      error: 'รหัสผ่านยืนยันไม่ตรงกัน',
      csrf_token: ensureCsrf(req),
      form: formEcho,
    });
  }

  const [ok, err] = userdb.createUser(username, password, false, email);
  if (!ok) {
    logSuspicious(req, `REGISTER_FAIL user=${username} reason=${err}`);
    return res.status(400).render('register', {
      error: err,
      csrf_token: ensureCsrf(req),
      form: formEcho,
    });
  }

  logger.info(`REGISTER_OK user=${username} email=${email} ip=${clientIp(req)}`);

  if (ENABLE_EMAIL_VERIFY) {
    console.log(`\n[VERIFY] ─── เริ่มขั้นตอนส่งอีเมลยืนยัน ───`);
    console.log(`[VERIFY] user=${username}  email=${email}`);

    try {
      const { token, expires_at } = verify.createVerification(
        username,
        email,
        'verify',
        VERIFY_TTL
      );
      console.log(`[VERIFY] token created  ttl=${VERIFY_TTL}s  expires=${new Date(expires_at).toLocaleString('th-TH')}`);
      console.log(`[VERIFY] token=${token.slice(0, 16)}...`);

      console.log(`[VERIFY] calling mailer.sendVerificationEmail...`);
      const send = await mailer.sendVerificationEmail(email, username, token);

      if (!send) {
        console.error(`[VERIFY] ⚠️ mailer คืนค่า undefined`);
      } else if (send.ok) {
        if (send.simulated) {
          console.log(`[VERIFY] ⚠️ SMTP ปิด — ใช้โหมด log (ดู log ด้านบน)`);
        } else {
          console.log(`[VERIFY] ✅ ส่งอีเมลสำเร็จ  messageId=${send.messageId}`);
        }
      } else {
        console.error(`[VERIFY] ❌ ส่งอีเมลล้มเหลว: ${send.error}`);
        logger.warn(`VERIFY_EMAIL_FAIL user=${username} err=${send.error}`);
      }

      const fallbackUrl = `${(process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '')}/verify?token=${encodeURIComponent(token)}`;
      console.log(`[VERIFY] 🔗 ลิงก์ยืนยัน (fallback):`);
      console.log(`[VERIFY]    ${fallbackUrl}`);
      console.log(`[VERIFY] ─────────────────────────────────\n`);

    } catch (e) {
      console.error(`[VERIFY] ❌ EXCEPTION: ${e.message}`);
      console.error(e.stack);
      logger.error(`VERIFY_CREATE_FAIL user=${username} err=${e.message}`);
    }

    return res.redirect('/login?registered=1&verify=1');
  }

  console.log(`[REGISTER] email verify ปิด — สมัครสำเร็จ ไม่ส่งเมล`);
  res.redirect('/login?registered=1');
});

app.get('/logout', (req, res) => {
  const user = currentUser(req) || '?';
  logger.info(`LOGOUT user=${user} ip=${clientIp(req)}`);
  req.session.destroy(() => {
    res.clearCookie('keeedum.sid');
    res.redirect('/login');
  });
});

// ============================================================
// EMAIL VERIFICATION — routes
// ============================================================
app.get('/verify-pending', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.redirect('/login');
  if (!ENABLE_EMAIL_VERIFY) return res.redirect('/');

  if (HAS_USERS && userdb.isEmailVerified && userdb.isEmailVerified(user)) {
    return res.redirect('/');
  }

  const u = HAS_USERS ? userdb.getUser(user) : null;
  res.render('verify-pending', {
    csrf_token: ensureCsrf(req),
    username: user,
    email: u ? u.email : '',
    cooldown: VERIFY_RESEND_CD,
  });
});

app.get('/verify', (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.render('verify', {
      csrf_token: ensureCsrf(req),
      ok: false,
      message: 'ไม่พบ token ในลิงก์',
      username: null,
    });
  }

  const r = verify.consumeToken(token, 'verify');
  if (!r.ok) {
    const map = {
      NOT_FOUND: 'ไม่พบ token นี้ในระบบ',
      USED: 'ลิงก์นี้ถูกใช้ไปแล้ว — กรุณาขอใหม่',
      EXPIRED: 'ลิงก์หมดอายุ — กรุณาขอใหม่',
      INVALID: 'token ไม่ถูกต้อง',
    };
    return res.render('verify', {
      csrf_token: ensureCsrf(req),
      ok: false,
      message: map[r.error] || 'ยืนยันไม่สำเร็จ',
      username: r.username || null,
    });
  }

  if (!HAS_USERS) {
    return res.render('verify', {
      csrf_token: ensureCsrf(req),
      ok: false,
      message: 'ระบบสมาชิกไม่พร้อม',
      username: r.username,
    });
  }

  try {
    userdb.setEmailVerified(r.username, true);
    logger.info(`EMAIL_VERIFIED user=${r.username} email=${r.email}`);
  } catch (e) {
    return res.render('verify', {
      csrf_token: ensureCsrf(req),
      ok: false,
      message: `บันทึกไม่สำเร็จ: ${e.message}`,
      username: r.username,
    });
  }

  mailer.sendWelcomeEmail(r.email, r.username).catch(() => {});

  res.render('verify', {
    csrf_token: ensureCsrf(req),
    ok: true,
    message: 'ยืนยันอีเมลสำเร็จ!',
    username: r.username,
  });
});

app.post('/api/verify/resend', requireLogin, requireCsrf, async (req, res) => {
  res.set('Content-Type', 'application/json');

  if (!ENABLE_EMAIL_VERIFY) {
    return res.status(400).json({ ok: false, error: 'ระบบปิดอยู่' });
  }

  const user = req.user;

  if (HAS_USERS && userdb.isEmailVerified && userdb.isEmailVerified(user)) {
    return res.json({ ok: true, already: true, message: 'อีเมลนี้ยืนยันแล้ว' });
  }

  const check = verify.canResend(user, VERIFY_RESEND_CD, VERIFY_RESEND_MAX);
  if (!check.ok) {
    if (check.reason === 'COOLDOWN') {
      return res.status(429).json({
        ok: false,
        error: 'COOLDOWN',
        message: `กรุณารออีก ${check.wait_sec} วินาที`,
        wait_sec: check.wait_sec,
      });
    }
    return res.status(429).json({
      ok: false,
      error: 'DAILY_LIMIT',
      message: `ส่งได้สูงสุด ${check.max} ครั้ง/วัน`,
      max: check.max,
    });
  }

  const u = HAS_USERS ? userdb.getUser(user) : null;
  if (!u || !u.email) {
    return res.status(400).json({ ok: false, error: 'ไม่พบอีเมลในบัญชี' });
  }

  console.log(`\n[VERIFY_RESEND] ─── เริ่มส่ง ───`);
  console.log(`[VERIFY_RESEND] user=${user}  email=${u.email}`);

  try {
    const { token, expires_at } = verify.createVerification(user, u.email, 'verify', VERIFY_TTL);
    console.log(`[VERIFY_RESEND] token=${token.slice(0, 16)}...  expires=${new Date(expires_at).toLocaleString('th-TH')}`);

    const send = await mailer.sendVerificationEmail(u.email, user, token);

    if (!send || !send.ok) {
      const errMsg = (send && send.error) || 'ไม่ทราบสาเหตุ';
      console.error(`[VERIFY_RESEND] ❌ ${errMsg}`);
      logger.warn(`VERIFY_RESEND_FAIL user=${user} err=${errMsg}`);

      return res.status(500).json({
        ok: false,
        error: 'ส่งอีเมลไม่สำเร็จ',
        message: errMsg,
      });
    }

    if (send.simulated) {
      console.log(`[VERIFY_RESEND] ⚠️ SMTP ปิด — log mode`);
    } else {
      console.log(`[VERIFY_RESEND] ✅ sent  id=${send.messageId}`);
    }

    const baseUrl = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
    console.log(`[VERIFY_RESEND] 🔗 ${baseUrl}/verify?token=${token}`);
    console.log(`[VERIFY_RESEND] ─────────────\n`);

    logger.info(`VERIFY_RESEND_OK user=${user} email=${u.email}`);

    res.json({
      ok: true,
      message: `ส่งอีเมลไปที่ ${u.email} แล้ว`,
      email: u.email,
      cooldown: VERIFY_RESEND_CD,
    });
  } catch (e) {
    console.error(`[VERIFY_RESEND] ❌ EXCEPTION: ${e.message}`);
    console.error(e.stack);
    logger.error(`VERIFY_RESEND_EXCEPTION user=${user} err=${e.message}`);
    res.status(500).json({ ok: false, error: e.message || 'เกิดข้อผิดพลาด' });
  }
});

app.get('/welcome', (req, res) => {
  if (currentUser(req)) return res.redirect('/');

  let stats = {
    users: 0,
    packages: 0,
    uptime_hours: Math.floor(process.uptime() / 3600),
    version: '1.0.0',
  };
  try {
    if (HAS_USERS && userdb.countUsers) stats.users = userdb.countUsers();
  } catch (_) {}
  try {
    if (HAS_SUBS && subs.PACKAGES) stats.packages = Object.keys(subs.PACKAGES).length;
  } catch (_) {}

  const personas = Object.keys(loadPersonas());
  const cfg = loadCfg();
  const currentModel = cfg.model || '';

  const features = [
    { icon: '💬', title: 'ตอบไทยล้วน',     desc: 'เข้าใจบริบทภาษาไทย สุภาพ กระชับ ตรงประเด็น ไม่ต้องแปล' },
    { icon: '⚙️', title: 'สร้าง/แก้โค้ด',   desc: 'เขียนไฟล์ Python, JS, HTML — เขียนลงดิสก์อัตโนมัติ แก้โค้ดเดิมได้' },
    { icon: '🎭', title: 'หลายนิสัย',        desc: `เลือก persona ตามงาน — ${personas.slice(0, 3).join(' / ')}${personas.length > 3 ? ' ฯลฯ' : ''}` },
    { icon: '🧠', title: 'หลายโมเดล',        desc: 'Groq, Llama, Mixtral — สลับได้ทันที ดึงรายการอัตโนมัติ' },
    { icon: '🎁', title: 'รางวัลประจำวัน',    desc: 'รับ +1 ชั่วโมงฟรี ทุกวัน ไม่มีเงื่อนไข' },
    { icon: '🛡️', title: 'เครื่องมือความปลอดภัย', desc: 'ตรวจ SPF / DKIM / DMARC + ตรวจจับ WAF จาก HTTP headers' },
  ];

  const steps = [
    {
      icon: '🔐',
      title: 'สมัครบัญชี',
      lines: [
        'กด "สมัครใหม่" → กรอกชื่อผู้ใช้ อีเมล รหัสผ่าน → ระบบส่งลิงก์ยืนยันไปที่อีเมล',
        'คลิกลิงก์ในอีเมล → ยืนยันสำเร็จ → login ได้เลย',
      ],
    },
    {
      icon: '🎁',
      title: 'รับรางวัลฟรี 1 ชั่วโมง',
      lines: [
        'หลัง login → ระบบจะเด้ง popup "รางวัลประจำวัน"',
        'กด "ไปกดรับ" → ได้ +1 ชั่วโมงทันที (รับได้วันละ 1 ครั้ง)',
      ],
    },
    {
      icon: '🧠',
      title: 'เลือกโมเดล + นิสัย',
      lines: [
        `ที่แถบซ้าย — เลือก "โมเดล"${currentModel ? ` (ปัจจุบัน: ${currentModel})` : ''}`,
        `เลือก "นิสัย" — ${personas.join(' / ')}`,
        'ปรับ temperature ได้ตามต้องการ (0 = แม่นยำ, 1.5 = สร้างสรรค์)',
      ],
    },
    {
      icon: '💬',
      title: 'เริ่มสนทนา',
      lines: [
        'พิมพ์คำสั่งที่ช่องล่าง → Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่',
        'ตัวอย่าง: สร้างสคริปต์ Python ดึงราคาหุ้น',
        'AI จะตอบ + เขียนไฟล์ลงโฟลเดอร์ที่ตั้งไว้ให้อัตโนมัติ',
      ],
    },
  ];

  const examples = [
    {
      icon: '💻',
      title: 'เขียนโค้ด',
      color: 'var(--accent)',
      items: [
        'สร้างโปรเจกต์ Flask ชื่อ hello',
        'เขียนสคริปต์ backup ไฟล์ลง Google Drive',
        'แปลง Excel เป็น JSON',
      ],
    },
    {
      icon: '⚙️',
      title: 'แก้โค้ดเดิม',
      color: 'var(--ok)',
      items: [
        'แก้ app.py ให้เพิ่ม logging',
        'ปรับ style.css ให้ปุ่มมี hover effect',
        'เพิ่ม authentication ใน server.js',
      ],
    },
    {
      icon: '📚',
      title: 'เรียนรู้',
      color: '#a855f7',
      items: [
        'อธิบาย async/await ใน JavaScript',
        'อธิบาย quantum computing ให้เด็ก ม.ปลาย เข้าใจ',
        'สอนใช้ regex',
      ],
    },
  ];

  res.render('welcome', {
    allow_register: ALLOW_REGISTER,
    app_url: APP_URL,
    app_title: APP_TITLE,
    stats,
    features,
    steps,
    examples,
    personas,
    current_model: currentModel,
  });
});

app.get('/api/verify/status', requireLogin, (req, res) => {
  const u = HAS_USERS ? userdb.getUser(req.user) : null;
  res.json({
    ok: true,
    username: req.user,
    email: u ? u.email : null,
    verified: u ? !!u.email_verified : true,
    verify_enabled: ENABLE_EMAIL_VERIFY,
    verify_required: VERIFY_REQUIRED,
  });
});

// ─── Daily reward ─────────────────────────────────────────
app.get('/daily', requireLogin, (req, res) => {
  res.render('daily', { csrf_token: ensureCsrf(req) });
});

app.get('/api/daily/status', requireLogin, (req, res) => {
  const stats = daily.getStats(req.user);
  res.json({
    ok: true,
    claimed_today: stats.claimed_today,
    total_claims: stats.total_claims,
    total_seconds: stats.total_seconds,
    next_reset: stats.next_reset,
    reward_seconds: daily.REWARD_SECONDS,
  });
});

app.post('/api/daily/claim', requireLogin, requireCsrf, (req, res) => {
  if (!loginLimiter.check(`daily:${req.user}`)) {
    return res.status(429).json({ ok: false, message: 'ลองมากเกินไป' });
  }
  const [ok, message, seconds, newExp] = daily.claimReward(req.user);
  if (ok) {
    logger.info(`DAILY_CLAIM user=${req.user} seconds=${seconds}`);
    return res.json({ ok: true, message, seconds, new_expires: newExp });
  }
  res.status(400).json({ ok: false, message });
});

app.get('/api/daily/history', requireLogin, (req, res) => {
  const rows = daily.listClaims(req.user, 30);
  const items = rows.map(r => ({
    id: r.id,
    date_text: new Date(r.claimed_at * 1000).toLocaleString('th-TH'),
    seconds: r.seconds,
  }));
  res.json({ ok: true, items });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false, logged_in: false, auth_required: true });
  ensureCsrf(req);
  res.json({
    ok: true,
    logged_in: true,
    username: user,
    is_admin: user === DEFAULT_ADMIN_USER,
    auth_required: true,
    csrf: req.session.csrf,
  });
});

// ─── Prompts / personas ───────────────────────────────────
app.get('/api/prompts', requireLogin, (req, res) => {
  checkRate(req);
  res.json(loadPersonas());
});

app.post('/api/prompts/reload', requireLogin, requireCsrf, (req, res) => {
  checkRate(req);
  const newPrompt = loadPromptTxt(true);
  logger.info(`PROMPT_RELOAD chars=${newPrompt.length}`);
  res.json({ ok: true, prompt_chars: newPrompt.length, personas: loadPersonas() });
});

app.get('/api/prompts/current', requireLogin, (req, res) => {
  checkRate(req);
  const content = loadPromptTxt(true);
  const isAdmin = isCurrentAdmin(req);
  res.json({
    ok: true,
    chars: content.length,
    preview: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
    full: isAdmin ? content : null,
    file_exists: fs.existsSync(PROMPT_FILE),
    file_path: PROMPT_FILE,
  });
});

// ─── Models ───────────────────────────────────────────────
app.get('/api/models', requireLogin, async (req, res) => {
  checkRate(req);
  if (!API_KEY) {
    return res.json({ ok: false, error: 'ยังไม่ได้ตั้ง API_KEY ใน .env', models: [] });
  }
  try {
    const r = await axios.get(`${API_BASE}/models`, {
      headers: buildHeaders(clientIp(req)),
      timeout: 15000,
      validateStatus: () => true,
      proxy: false,
    });
    if (r.status !== 200) {
      return res.json({
        ok: false,
        error: `API HTTP ${r.status}: ${String(r.data).slice(0, 200)}`,
        models: [],
      });
    }
    const data = r.data || {};
    const raw = data.data || data.models || [];
    if (!Array.isArray(raw)) {
      return res.json({ ok: false, error: 'รูปแบบ models ไม่ถูกต้อง', models: [] });
    }
    const models = raw
      .filter(m => m && typeof m === 'object')
      .map(m => {
        const mid = String(m.id || m.name || '').trim();
        if (!mid) return null;
        const owner = String(m.owned_by || '');
        return { name: mid, size: '', size_bytes: 0, param: owner, quant: '', family: owner, modified: String(m.created || '') };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ ok: true, models, host: API_BASE });
  } catch (e) {
    if (e.code === 'ECONNREFUSED') {
      return res.json({ ok: false, error: `เชื่อมต่อ ${API_BASE} ไม่ได้`, models: [] });
    }
    if (e.code === 'ECONNABORTED') {
      return res.json({ ok: false, error: 'API ตอบช้า (timeout)', models: [] });
    }
    res.json({ ok: false, error: String(e.message).slice(0, 200), models: [] });
  }
});

app.post('/api/models/select', requireLogin, requireCsrf, (req, res) => {
  checkRate(req);
  const model = String(req.body?.model || '').trim().slice(0, 200);
  if (!model) return res.json({ ok: false, error: 'ไม่มีชื่อโมเดล' });
  const cfg = loadCfg();
  cfg.model = model;
  saveCfg(cfg);
  res.json({ ok: true, model });
});

app.post('/api/models/warm', requireLogin, requireCsrf, async (req, res) => {
  checkRate(req);
  const model = String(req.body?.model || '').trim().slice(0, 200);
  if (!model) return res.json({ ok: false, error: 'ไม่มีชื่อโมเดล' });

  const r = await openaiChatRaw('hi', {
    model, maxTokensRange: [1, 1], temperature: 0, timeout: 60_000,
  });
  if (r.ok) res.json({ ok: true, model });
  else res.json({ ok: false, error: r.error });
});

// ─── Config / Folder ──────────────────────────────────────
app.get('/api/config', requireLogin, (req, res) => {
  checkRate(req);
  res.json(loadCfg());
});

app.post('/api/config', requireLogin, (req, res) => {
  checkRate(req);
  const token = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
  if (!csrfTokens.verify(token, req.session?.csrf)) {
    logSuspicious(req, 'CSRF_FAIL');
    return res.status(403).json({ ok: false, error: 'CSRF ไม่ถูกต้อง' });
  }
  const cfg = loadCfg();
  const allowed = new Set(['persona', 'model', 'temp']);
  for (const k of Object.keys(req.body || {})) {
    if (allowed.has(k)) cfg[k] = req.body[k];
  }
  saveCfg(cfg);
  res.json(cfg);
});

app.get('/api/folder', requireLogin, (req, res) => {
  checkRate(req);
  const cfg = loadCfg();
  let cur = cfg.folder || String(ALLOWED_ROOTS[0]);
  try { cur = String(getSafeFolder(cur)); } catch (_) { cur = String(ALLOWED_ROOTS[0]); }
  res.json({ folder: cur, allowed: ALLOWED_ROOTS.map(String) });
});

app.post('/api/folder', requireLogin, (req, res) => {
  checkRate(req);
  const token = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
  if (!csrfTokens.verify(token, req.session?.csrf)) {
    logSuspicious(req, 'CSRF_FAIL');
    return res.status(403).json({ ok: false, error: 'CSRF ไม่ถูกต้อง' });
  }
  const cfg = loadCfg();
  let folder;
  try { folder = getSafeFolder(req.body?.folder); }
  catch (e) { return res.status(403).json({ ok: false, error: e.message }); }
  cfg.folder = String(folder);
  saveCfg(cfg);
  res.json({ folder: String(folder) });
});

app.post('/api/browse', requireLogin, requireCsrf, (req, res) => {
  checkRate(req);
  let p;
  try { p = getSafeFolder(req.body?.path); }
  catch (e) { return res.status(403).json({ ok: false, error: e.message }); }

  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
    return res.json({ ok: false, error: 'ไม่พบโฟลเดอร์' });
  }
  let dirs;
  try {
    dirs = fs.readdirSync(p, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name))
      .map(d => d.name)
      .sort();
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }

  const parent = path.dirname(p);
  let parentStr = null;
  for (const root of ALLOWED_ROOTS) {
    if (isSubpath(parent, root)) { parentStr = parent; break; }
  }

  res.json({
    ok: true,
    path: String(p),
    parent: parentStr,
    dirs,
    roots: ALLOWED_ROOTS.map(String),
  });
});

// ─── Chat (SSE) ───────────────────────────────────────────
app.post('/api/chat', requireActive, requireCsrf, async (req, res) => {
  checkRate(req);
  if (!API_KEY) return res.status(500).json({ ok: false, error: 'ไม่ตั้ง API_KEY' });

  const data = req.body || {};
  let messages, persona, model, temp, editmode, folder;

  try {
    messages = data.messages || [];
    if (!Array.isArray(messages)) throw new Error('messages ไม่ถูกต้อง');
    messages = messages.slice(-6);
    for (const m of messages) {
      if (!m || typeof m !== 'object') throw new Error('messages มีข้อมูลผิด');
      m.content = validateText(m.content || '', 50_000, 'message');
    }
    persona  = String(data.persona || 'ปกติ').slice(0, 50);
    model    = String(data.model || '').trim().slice(0, 200);
    if (!model) return res.status(400).json({ ok: false, error: 'ยังไม่ได้เลือกโมเดล' });
    temp     = validateFloat(data.temp ?? 0.0, 0, 2, 'temp');
    editmode = data.editmode !== false;
    folder   = getSafeFolder(data.folder);
  } catch (e) {
    logSuspicious(req, `CHAT_INPUT ${e.message}`);
    return res.status(400).json({ ok: false, error: e.message });
  }

  const promptBase = loadPromptTxt(true);
  const personas = loadPersonas();
  let personaBody = personas[persona] || '';

  let sysContent = '';
  if (personaBody) sysContent = personaBody;
  if (promptBase) {
    sysContent = sysContent ? sysContent + '\n\n' + promptBase : promptBase;
  }

  if (!sysContent) {
    if (!promptBase && !personaBody) {
      logger.error('CHAT_NO_PROMPT');
      return res.status(500).json({
        ok: false,
        error: 'ไม่พบ prompt.txt หรือ personas — กรุณาสร้างก่อนใช้งาน',
      });
    }
  }

  logger.info(
    `CHAT_START user=${req.user} persona=${persona} ` +
    `sys_chars=${sysContent.length} (persona=${personaBody.length}, base=${promptBase.length})`
  );

  if (editmode && messages.length) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    let ctx = '';
    try { ctx = buildEditContext(folder, lastUser); }
    catch (e) { logger.warn(`BUILD_EDIT_CONTEXT_ERROR: ${e.message}`); }

    if (ctx) {
      sysContent +=
        '\n\n' +
        '=== กฎการแก้ไขโค้ดเดิม (สำคัญมาก) ===\n' +
        '- ให้แก้ไข/ปรับปรุงจากโค้ดเดิมด้านล่างเท่านั้น ห้ามเขียนใหม่ทั้งหมด\n' +
        '- คงโครงสร้าง ฟังก์ชัน และชื่อตัวแปรเดิม ไว้ให้มากที่สุด\n' +
        '- แก้เฉพาะจุดที่ผู้ใช้ขอ หรือจุดที่จำเป็นจริง ๆ\n' +
        '- ห้ามลบฟังก์ชันหรือโค้ดเดิม ที่ไม่เกี่ยวข้องกับคำขอ\n' +
        '- ตอบเป็น file:path\\n<โค้ดเต็มที่แก้แล้ว>\\n สำหรับไฟล์ที่แก้\n' +
        '- ถ้าแก้หลายไฟล์ ให้ส่งบล็อก file: หลายอัน\n' +
        '- ไฟล์ที่ไม่แก้ ไม่ต้องส่ง\n' +
        '\n=== ไฟล์ในโปรเจกต์ปัจจุบัน ===\n' + ctx;
    }
  }

  const lastUserContent = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  if (!lastUserContent.trim()) {
    return res.status(400).json({ ok: false, error: 'ไม่มีคำถาม' });
  }

  const result = await openaiChatRaw(lastUserContent, {
    model, pay: '', fip: clientIp(req),
    systemPrompt: sysContent,
    maxTokensRange: [850, 1050],
    temperature: temp,
    timeout: API_TIMEOUT_READ,
  });

  if (!result.ok) {
    logger.error(`CHAT_ERROR ${result.error}`);
    return res.status(502).json({ ok: false, error: result.error });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const content = result.content;
  const step = 40;
  for (let i = 0; i < content.length; i += step) {
    res.write(`data: ${JSON.stringify({ content: content.slice(i, i + step) })}\n\n`);
  }
  res.write('data: {"done": true}\n\n');
  res.end();

  logger.info(`CHAT_DONE user=${req.user} reply_chars=${content.length}`);
});

// ─── Save files ───────────────────────────────────────────
app.post('/api/save_files', requireActive, requireCsrf, (req, res) => {
  checkRate(req);
  const data = req.body || {};
  let text;
  try { text = validateText(data.text || '', 1_000_000, 'text'); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  const autowrite = data.autowrite !== false;
  let folder;
  try { folder = getSafeFolder(data.folder); }
  catch (e) { return res.status(403).json({ ok: false, error: e.message }); }

  const matches = [];
  const re = /file:([^\n]+)\n([\s\S]*?)(?=\nfile:|$)/g;
  let m;
  while ((m = re.exec(text))) {
    matches.push([m[1], m[2]]);
  }
  if (!matches.length) {
    return res.json({ ok: true, files: [], skipped: true, reason: 'no files' });
  }
  if (!autowrite) {
    return res.json({ ok: true, skipped: true, reason: 'โหมดไม่เขียนอัตโนมัติ', count: matches.length });
  }

  const ok = [], er = [];
  for (const [rp, ct] of matches.slice(0, 50)) {
    let tgt;
    try { tgt = safeJoin(folder, rp); }
    catch (e) {
      er.push(`ปฏิเสธ ${rp}: ${e.message}`);
      logSuspicious(req, `SAVE_PATH ${rp}`);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(tgt), { recursive: true });
      const existed = fs.existsSync(tgt);
      if (existed) {
        let bak = tgt + '.bak';
        let i = 1;
        while (fs.existsSync(bak)) bak = `${tgt}.bak${i++}`;
        fs.renameSync(tgt, bak);
      }
      fs.writeFileSync(tgt, ct, 'utf8');
      ok.push({ tag: existed ? '✏️ แก้' : '➕ ใหม่', path: rp });
    } catch (e) {
      er.push(`${rp}: ${e.message}`);
    }
  }

  res.json({ ok: true, written: ok, errors: er, folder: String(folder) });
});

app.post('/api/open_folder', requireLogin, requireCsrf, (req, res) => {
  checkRate(req);
  let folder;
  try { folder = getSafeFolder(req.body?.folder); }
  catch (e) { return res.status(403).json({ ok: false, error: e.message }); }

  const { spawn } = require('child_process');
  try {
    if (process.platform === 'win32') {
      spawn('explorer', [folder], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [folder], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [folder], { detached: true, stdio: 'ignore' }).unref();
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── Subscription / Buy ───────────────────────────────────
app.post('/api/buy/with_wallet', requireCsrf, (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'ต้อง login' });
  if (!SUBSCRIPTION_ENABLED) return res.status(403).json({ ok: false, error: 'ปิดระบบ subscription' });
  if (!HAS_SUBS) return res.status(500).json({ ok: false, error: 'ระบบ subscription ไม่พร้อม' });

  const pkgKey = String(req.body?.package || '').trim();
  if (!(pkgKey in subs.PACKAGES)) return res.status(400).json({ ok: false, error: 'แพ็กเกจไม่ถูกต้อง' });

  const pkg = subs.PACKAGES[pkgKey];
  const price = pkg.price;

  const w = walletdb.getWallet(user);
  const balance = w ? w.balance : 0;
  if (balance < price) {
    return res.status(400).json({
      ok: false, error: 'INSUFFICIENT',
      message: `เงินในกระเป๋าไม่พอ (มี ฿${balance.toFixed(2)} ต้องการ ฿${price.toFixed(2)})`,
      balance, required: price, need_topup: true,
    });
  }

  const [ok, err, newBalance] = walletdb.deductBalance(user, price);
  if (!ok) return res.status(400).json({ ok: false, error: err });

  const seconds = pkg.seconds;
  const newExp = subs.addTime(user, seconds);

  const pid = subs.createPending(user, pkgKey, 'wallet_purchase');
  try {
    const conn = require('better-sqlite3')(subs.DB_FILE);
    conn.prepare("UPDATE purchases SET status='approved', admin_note=?, approved_at=? WHERE id=?")
        .run(`จ่ายจากกระเป๋า ฿${price.toFixed(2)}`, Date.now() / 1000, pid);
    conn.prepare("UPDATE users SET total_paid = total_paid + ? WHERE user = ?").run(price, user);
    conn.close();
  } catch (e) { logger.warn(`wallet-purchase log error: ${e.message}`); }

  try { walletdb.createTopup(user, `buy:${pkgKey}`, -price); } catch (_) {}

  const newExpText = new Date(newExp * 1000).toLocaleString('th-TH');
  logger.info(`WALLET_PURCHASE user=${user} pkg=${pkgKey} price=${price}`);

  res.json({
    ok: true,
    message: `ซื้อ ${pkg.name} สำเร็จ (จ่าย ฿${price.toFixed(2)})`,
    balance: newBalance,
    days: Math.floor(seconds / 86400),
    new_expires: newExpText,
    new_expires_ts: newExp,
  });
});

app.get('/buy', requireLogin, (req, res) => {
  ensureCsrf(req);
  if (!HAS_SUBS) return res.status(500).send('subscription ไม่พร้อม');

  const packagesJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(subs.PACKAGES).map(([k, v]) => [k, { name: v.name, price: v.price }])
    )
  );

  res.render('buy', {
    csrf_token: req.session.csrf,
    packages: subs.PACKAGES,
    packages_json: packagesJson,
    payment_phone: PAYMENT_PHONE,
    payment_name: PAYMENT_NAME,
  });
});

app.get('/wallet', requireLogin, (req, res) => {
  res.render('wallet', { csrf_token: ensureCsrf(req) });
});

app.get('/api/wallet', requireLogin, (req, res) => {
  const w = walletdb.getWallet(req.user);
  res.json({ ok: true, user: req.user, balance: w.balance, total_topup: w.total_topup });
});

app.get('/api/wallet/history', requireLogin, (req, res) => {
  const items = walletdb.listTopups(req.user, 30);
  res.json({
    ok: true,
    items: items.map(t => ({
      id: t.id, amount: t.amount, status: t.status,
      error_msg: t.error_msg, created_at: t.created_at,
    })),
  });
});

app.post('/api/wallet/redeem', requireCsrf, async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'ต้อง login' });
  if (!loginLimiter.check(`redeem:${user}`)) {
    return res.status(429).json({ ok: false, message: 'ลองมากเกินไป รอสักครู่' });
  }

  const link = String(req.body?.link || '').trim();
  if (!link) return res.status(400).json({ ok: false, message: 'กรุณาใส่ลิงก์' });
  if (!tmn.validateLink(link)) {
    return res.status(400).json({
      ok: false,
      message: 'รูปแบบลิงก์อั่งเปาไม่ถูกต้อง (ต้องขึ้นต้นด้วย https://gift.truemoney.com/campaign/?v=...)',
    });
  }

  const voucher = tmn.extractVoucher(link) || '';
  const pid = walletdb.createTopup(user, voucher, 0);

  const result = await tmn.redeem(link, PAYMENT_PHONE);
  if (result.success) {
    const amount = result.amount;
    walletdb.completeTopup(pid, amount);
    const newBalance = walletdb.addBalance(user, amount);
    logger.info(`WALLET_REDEEM user=${user} amount=${amount} pid=${pid}`);
    return res.json({
      ok: true, amount, balance: newBalance,
      message: `รับเงินสำเร็จ ฿${amount.toFixed(2)}`,
    });
  } else {
    walletdb.completeTopup(pid, 0, result.message);
    logSuspicious(req, `REDEEM_FAIL user=${user} err=${result.error}`);
    return res.status(400).json({ ok: false, error: result.error, message: result.message });
  }
});

app.post('/api/wallet/exchange', requireCsrf, (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'ต้อง login' });

  const days = parseInt(req.body?.days, 10) || 0;
  if (days < 1 || days > 365) return res.status(400).json({ ok: false, error: 'จำนวนวันไม่ถูกต้อง' });

  const cost = days * walletdb.RATE_BAHT_PER_DAY;
  const [ok, err, newBalance] = walletdb.deductBalance(user, cost);
  if (!ok) return res.status(400).json({ ok: false, error: err });

  let newExp = 0;
  if (HAS_SUBS) newExp = subs.addTime(user, days * walletdb.SECONDS_PER_DAY);

  logger.info(`WALLET_EXCHANGE user=${user} days=${days} cost=${cost}`);
  res.json({
    ok: true, balance: newBalance, days, cost,
    message: `แลกสำเร็จ ${days} วัน (ใช้ ฿${cost})`,
  });
});

app.get('/status', requireLogin, (req, res) => {
  res.render('status', { csrf_token: ensureCsrf(req) });
});

app.get('/admin', (req, res) => {
  if (!isCurrentAdmin(req)) return res.redirect('/login');
  res.render('admin', { csrf_token: ensureCsrf(req) });
});

app.post('/api/buy/redeem_and_purchase', requireCsrf, async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: 'ต้อง login' });
  if (!HAS_SUBS) return res.status(500).json({ ok: false, message: 'ระบบไม่พร้อม' });
  if (!loginLimiter.check(`redeem:${user}`)) {
    return res.status(429).json({ ok: false, message: 'ลองมากเกินไป รอสักครู่' });
  }

  const pkgKey = String(req.body?.package || '').trim();
  const link = String(req.body?.link || '').trim();

  if (!(pkgKey in subs.PACKAGES)) return res.status(400).json({ ok: false, message: 'แพ็กเกจไม่ถูกต้อง' });
  if (!link) return res.status(400).json({ ok: false, message: 'กรุณาใส่ลิงก์ซอง' });
  if (!tmn.validateLink(link)) {
    return res.status(400).json({
      ok: false,
      message: 'ลิงก์ไม่ถูกต้อง (ต้องเป็น https://gift.truemoney.com/campaign/?v=...)',
    });
  }

  const pkg = subs.PACKAGES[pkgKey];
  const voucher = tmn.extractVoucher(link) || '';
  logger.info(`REDEEM user=${user} voucher=${voucher.slice(0, 8)}...`);

  const result = await tmn.redeem(link, PAYMENT_PHONE);
  if (!result.success) {
    logSuspicious(req, `REDEEM_FAIL user=${user} err=${result.error}`);
    return res.status(400).json({ ok: false, message: result.message, error: result.error });
  }

  const amount = result.amount;
  if (amount < pkg.price) {
    walletdb.addBalance(user, amount);
    logger.info(`REDEEM_PARTIAL user=${user} amount=${amount} need=${pkg.price}`);
    return res.status(400).json({
      ok: false,
      message: `ได้ ฿${amount.toFixed(2)} แต่แพ็กต้อง ฿${pkg.price} — เงินเก็บในกระเป๋าแล้ว`,
      amount,
      balance: walletdb.getWallet(user).balance,
    });
  }

  const newExp = subs.addTime(user, pkg.seconds);
  const pid = subs.createPending(user, pkgKey, `gift_${voucher.slice(0, 16)}.txt`);
  try {
    const conn = require('better-sqlite3')(subs.DB_FILE);
    conn.prepare("UPDATE purchases SET status='approved', admin_note=?, approved_at=? WHERE id=?")
        .run(`Gift ฿${amount.toFixed(2)}`, Date.now() / 1000, pid);
    conn.prepare("UPDATE users SET total_paid = total_paid + ? WHERE user = ?").run(pkg.price, user);
    conn.close();
  } catch (e) { logger.warn(`auto-approve error: ${e.message}`); }

  const newExpText = new Date(newExp * 1000).toLocaleString('th-TH');
  logger.info(`REDEEM_PURCHASE_OK user=${user} pkg=${pkgKey} amount=${amount}`);

  res.json({
    ok: true,
    message: `รับ ฿${amount.toFixed(2)} + ซื้อ ${pkg.name} สำเร็จ`,
    amount,
    days: Math.floor(pkg.seconds / 86400),
    new_expires: newExpText,
    new_expires_ts: newExp,
  });
});

app.get('/api/buy/status', requireLogin, (req, res) => {
  if (!HAS_SUBS) return res.status(500).json({ ok: false, error: 'ระบบ subscription ไม่พร้อม' });
  const u = subs.getUser(req.user);
  const rem = subs.getRemaining(req.user);
  const expTs = u ? u.expires_at : 0;
  const expText = expTs > 0 ? new Date(expTs * 1000).toLocaleString('th-TH') : '-';
  res.json({
    ok: true, user: req.user,
    remaining: Math.floor(rem),
    remaining_text: subs.fmtTime(rem),
    expires_at: expTs,
    expires_text: expText,
    total_paid: u ? Math.floor(u.total_paid) : 0,
  });
});

app.get('/api/buy/history', requireLogin, (req, res) => {
  if (!HAS_SUBS) return res.json({ ok: true, items: [] });
  const items = subs.listPurchases(req.user, 30);
  const statusMap = {
    pending:  ['⏳ รอตรวจ', 'pending'],
    approved: ['✅ อนุมัติ', 'approved'],
    rejected: ['❌ ปฏิเสธ', 'rejected'],
  };
  const out = items.map(p => {
    const pkg = subs.PACKAGES[p.package] || {};
    const dt = new Date(p.purchased_at * 1000).toLocaleString('th-TH');
    const [stTxt, stCls] = statusMap[p.status] || [p.status, 'pending'];
    return {
      id: p.id,
      pkg_name: pkg.name || p.package,
      price: Math.floor(p.price),
      date_text: dt,
      status_text: stTxt,
      status: stCls,
      admin_note: p.admin_note || '',
    };
  });
  res.json({ ok: true, items: out });
});

app.post('/api/buy/submit', requireCsrf, (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'ต้อง login' });
  if (!HAS_SUBS) return res.status(500).json({ ok: false, error: 'ระบบ subscription ไม่พร้อม' });

  const pkgKey = String(req.body?.package || '').trim();
  const slipData = String(req.body?.slip || '').trim();

  if (!(pkgKey in subs.PACKAGES)) return res.status(400).json({ ok: false, error: 'แพ็กเกจไม่ถูกต้อง' });
  if (!slipData || !slipData.startsWith('data:image/')) {
    return res.status(400).json({ ok: false, error: 'สลิปไม่ถูกต้อง' });
  }

  try {
    const [header, b64] = slipData.split(',', 2);
    let ext = '.jpg';
    if (header.includes('png')) ext = '.png';
    else if (header.includes('webp')) ext = '.webp';

    const imgBuf = Buffer.from(b64, 'base64');
    if (imgBuf.length > 5 * 1024 * 1024)
      return res.status(400).json({ ok: false, error: 'ไฟล์ใหญ่เกิน 5 MB' });

    const fname = subs.genSlipFilename(user, ext);
    const fpath = path.join(subs.UPLOAD_DIR, fname);
    fs.writeFileSync(fpath, imgBuf);

    const pid = subs.createPending(user, pkgKey, fname);
    logger.info(`BUY_PENDING user=${user} pkg=${pkgKey} pid=${pid}`);
    res.json({ ok: true, id: pid, message: 'รอ admin อนุมัติ' });
  } catch (e) {
    res.status(500).json({ ok: false, error: `อัปโหลดล้มเหลว: ${e.message}` });
  }
});

// ─── Admin API ────────────────────────────────────────────
app.get('/api/admin/pending', (req, res) => {
  if (!isCurrentAdmin(req)) return res.status(403).json({ ok: false, items: [] });
  if (!HAS_SUBS) return res.json({ ok: true, items: [] });

  const items = subs.listPending();
  const out = items.map(p => {
    const pkg = subs.PACKAGES[p.package] || {};
    const slipUrl = p.slip_file ? `/static/uploads/${p.slip_file}` : null;
    return {
      id: p.id, user: p.user,
      pkg_name: pkg.name || p.package,
      price: Math.floor(p.price),
      purchased_at: p.purchased_at,
      slip_url: slipUrl,
    };
  });
  res.json({ ok: true, items: out });
});

app.post('/api/admin/approve', requireCsrf, (req, res) => {
  if (!isCurrentAdmin(req)) return res.status(403).json({ ok: false, error: 'ไม่มีสิทธิ์' });
  const pid = parseInt(req.body?.id, 10) || 0;
  const note = String(req.body?.note || '').slice(0, 500);
  try {
    const newExp = subs.approvePurchase(pid, note);
    logger.info(`APPROVE pid=${pid} by=${currentUser(req)} new_exp=${newExp}`);
    res.json({ ok: true, expires_at: newExp });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/reject', requireCsrf, (req, res) => {
  if (!isCurrentAdmin(req)) return res.status(403).json({ ok: false, error: 'ไม่มีสิทธิ์' });
  const pid = parseInt(req.body?.id, 10) || 0;
  const note = String(req.body?.note || '').slice(0, 500);
  try {
    subs.rejectPurchase(pid, note);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/add_time', requireCsrf, (req, res) => {
  if (!isCurrentAdmin(req)) return res.status(403).json({ ok: false, error: 'ไม่มีสิทธิ์' });
  if (!HAS_SUBS) return res.status(500).json({ ok: false, error: 'ระบบ subscription ไม่พร้อม' });

  const targetUser = String(req.body?.user || '').trim();
  if (!targetUser) return res.status(400).json({ ok: false, error: 'ต้องระบุ user' });

  if (HAS_USERS && !userdb.getUser(targetUser)) {
    return res.status(404).json({ ok: false, error: `ไม่พบ user '${targetUser}'` });
  }

  let seconds = 0;
  if ('seconds' in req.body) seconds = parseInt(req.body.seconds, 10);
  else if ('hours' in req.body) seconds = parseInt(req.body.hours, 10) * 3600;
  else if ('days' in req.body) seconds = parseInt(req.body.days, 10) * 86400;
  else return res.status(400).json({ ok: false, error: 'ต้องระบุ days/hours/seconds' });

  if (!Number.isFinite(seconds) || seconds <= 0)
    return res.status(400).json({ ok: false, error: 'เวลาต้องมากกว่า 0' });
  if (seconds > 365 * 86400 * 10)
    return res.status(400).json({ ok: false, error: 'เวลามากเกินไป (สูงสุด 10 ปี)' });

  let newExp;
  try { newExp = subs.addTime(targetUser, seconds); }
  catch (e) {
    logger.error(`ADD_TIME_FAIL user=${targetUser} err=${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }

  const note = String(req.body?.note || 'admin add_time').slice(0, 500);
  try {
    subs.logAdminAction(currentUser(req), targetUser, seconds, note);
  } catch (e) { logger.warn(`add_time log error: ${e.message}`); }

  const newExpText = new Date(newExp * 1000).toLocaleString('th-TH');
  logger.info(`ADMIN_ADD_TIME by=${currentUser(req)} to=${targetUser} sec=${seconds}`);

  res.json({
    ok: true, user: targetUser,
    seconds_added: seconds,
    days_added: Math.floor(seconds / 86400),
    new_expires_ts: newExp,
    new_expires: newExpText,
  });
});

app.post('/api/admin/set_time', requireCsrf, (req, res) => {
  if (!isCurrentAdmin(req)) return res.status(403).json({ ok: false, error: 'ไม่มีสิทธิ์' });
  if (!HAS_SUBS) return res.status(500).json({ ok: false, error: 'ระบบ subscription ไม่พร้อม' });

  const targetUser = String(req.body?.user || '').trim();
  if (!targetUser) return res.status(400).json({ ok: false, error: 'ต้องระบุ user' });

  const expiresAt = parseFloat(req.body?.expires_at || 0);
  if (!Number.isFinite(expiresAt))
    return res.status(400).json({ ok: false, error: 'expires_at ไม่ถูกต้อง' });
  if (expiresAt <= Date.now() / 1000)
    return res.status(400).json({ ok: false, error: 'เวลาหมดอายุต้องอยู่ในอนาคต' });

  let newExp;
  if (typeof subs.setExpires === 'function') {
    newExp = subs.setExpires(targetUser, expiresAt);
  } else {
    const cur = subs.getRemaining(targetUser);
    const diff = expiresAt - Date.now() / 1000;
    if (diff > cur) newExp = subs.addTime(targetUser, Math.floor(diff - cur));
    else newExp = expiresAt;
  }

  const newExpText = new Date(newExp * 1000).toLocaleString('th-TH');
  res.json({ ok: true, user: targetUser, expires_at: Math.floor(newExp), expires_text: newExpText });
});

app.get('/api/admin/user_status', (req, res) => {
  if (!isCurrentAdmin(req)) return res.status(403).json({ ok: false, error: 'ไม่มีสิทธิ์' });
  if (!HAS_SUBS) return res.status(500).json({ ok: false, error: 'ระบบ subscription ไม่พร้อม' });

  const targetUser = String(req.query.user || '').trim();
  if (!targetUser) return res.status(400).json({ ok: false, error: 'ต้องระบุ user' });

  const u = subs.getUser(targetUser);
  const rem = subs.getRemaining(targetUser);
  const expTs = u ? u.expires_at : 0;
  const expText = expTs > 0 ? new Date(expTs * 1000).toLocaleString('th-TH') : '-';

  let walletBal = 0;
  try { walletBal = walletdb.getWallet(targetUser).balance; } catch (_) {}

  res.json({
    ok: true, user: targetUser,
    remaining: Math.floor(rem),
    remaining_text: subs.fmtTime(rem),
    expires_at: expTs,
    expires_text: expText,
    total_paid: u ? Math.floor(u.total_paid) : 0,
    wallet_balance: walletBal,
  });
});

app.get('/api/admin/list_users', (req, res) => {
  if (!isCurrentAdmin(req)) return res.status(403).json({ ok: false, error: 'ไม่มีสิทธิ์' });
  if (!HAS_USERS) return res.json({ ok: true, items: [] });

  try {
    const users = userdb.listUsers();
    const out = users.map(u => {
      const uname = u.username;
      let rem = 0;
      if (HAS_SUBS) {
        try { rem = Math.floor(subs.getRemaining(uname)); } catch (_) { rem = 0; }
      }
      return {
        username: uname,
        is_admin: !!u.is_admin,
        remaining: rem,
        remaining_text: HAS_SUBS ? subs.fmtTime(rem) : '-',
      };
    });
    res.json({ ok: true, items: out });
  } catch (e) {
    logger.error(`LIST_USERS_FAIL: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message, items: [] });
  }
});

// ============================================================
// TOOLS — Mail Security (SPF/DKIM/DMARC) + WAF Detection
// ============================================================
const MAIL_TOOLS_ENABLED = ['1','true','yes'].includes(
  String(process.env.ENABLE_MAIL_TOOLS || 'true').toLowerCase()
);

function requireMailTools(req, res, next) {
  if (!MAIL_TOOLS_ENABLED) {
    return res.status(403).json({ ok: false, error: 'mail tools ปิดอยู่' });
  }
  next();
}

app.get('/tools/mail', requireLogin, (req, res) => {
  ensureCsrf(req);
  res.render('tools-mail', {
    csrf_token: req.session.csrf,
    username: req.user,
  });
});

app.get('/api/tools/mail/spf', requireLogin, requireMailTools, async (req, res) => {
  checkRate(req);
  const domain = String(req.query.domain || '').trim();
  if (!mailTools.isValidDomain(domain)) {
    return res.status(400).json({ ok: false, error: 'domain ไม่ถูกต้อง' });
  }
  try {
    const r = await mailTools.checkSPF(domain);
    res.json({ ok: true, domain, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/tools/mail/dmarc', requireLogin, requireMailTools, async (req, res) => {
  checkRate(req);
  const domain = String(req.query.domain || '').trim();
  if (!mailTools.isValidDomain(domain)) {
    return res.status(400).json({ ok: false, error: 'domain ไม่ถูกต้อง' });
  }
  try {
    const r = await mailTools.checkDMARC(domain);
    res.json({ ok: true, domain, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// ACCOUNT — หน้าจัดการบัญชี + API
// ============================================================

app.get('/account', requireLogin, (req, res) => {
  ensureCsrf(req);
  const u = HAS_USERS ? userdb.getUser(req.user) : null;
  const prof = account.getProfile(req.user);

  let sub = { remaining: 0, remaining_text: '-', expires_text: '-' };
  if (HAS_SUBS) {
    const r = subs.getRemaining(req.user);
    const subrow = subs.getUser(req.user);
    const exp = subrow ? subrow.expires_at : 0;
    sub = {
      remaining: Math.floor(r),
      remaining_text: subs.fmtTime(r),
      expires_text: exp > 0 ? new Date(exp * 1000).toLocaleString('th-TH') : '-',
    };
  }

  let wallet = { balance: 0, total_topup: 0 };
  try {
    const w = walletdb.getWallet(req.user);
    wallet = { balance: w.balance, total_topup: w.total_topup };
  } catch (_) {}

  res.render('account', {
    csrf_token: req.session.csrf,
    username: req.user,
    email: u ? u.email : '',
    email_verified: u ? !!u.email_verified : false,
    is_admin: req.user === DEFAULT_ADMIN_USER,
    profile: prof,
    subscription: sub,
    wallet,
    verify_enabled: ENABLE_EMAIL_VERIFY,
  });
});

// ---- Profile update ----
app.post('/api/account/profile', requireLogin, requireCsrf, (req, res) => {
  const display_name = String(req.body?.display_name || '').trim();
  const bio = String(req.body?.bio || '').trim();
  try {
    const p = account.updateProfile(req.user, { display_name, bio });
    account.logActivity(req.user, 'profile.update', null, clientIp(req), getUa(req));
    res.json({ ok: true, profile: p });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- Change password ----
app.post('/api/account/change-password', requireLogin, requireCsrf, (req, res) => {
  if (!HAS_USERS) return res.status(500).json({ ok: false, error: 'ระบบไม่พร้อม' });

  const oldPw = String(req.body?.old_password || '');
  const newPw = String(req.body?.new_password || '');
  const cfPw  = String(req.body?.confirm_password || '');

  if (!oldPw || !newPw) return res.status(400).json({ ok: false, error: 'กรอกให้ครบ' });
  if (newPw !== cfPw)   return res.status(400).json({ ok: false, error: 'รหัสใหม่ไม่ตรงกัน' });
  if (newPw.length < 6) return res.status(400).json({ ok: false, error: 'รหัสใหม่สั้นเกินไป' });

  const [ok, err] = userdb.changePassword(req.user, oldPw, newPw);
  if (!ok) {
    account.logActivity(req.user, 'password.change.fail', err, clientIp(req), getUa(req));
    return res.status(400).json({ ok: false, error: err });
  }

  account.logActivity(req.user, 'password.change', null, clientIp(req), getUa(req));
  logger.info(`PASSWORD_CHANGED user=${req.user} ip=${clientIp(req)}`);
  res.json({ ok: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
});

// ---- Email: เปลี่ยนอีเมล ----
app.post('/api/account/change-email', requireLogin, requireCsrf, async (req, res) => {
  if (!HAS_USERS) return res.status(500).json({ ok: false, error: 'ระบบไม่พร้อม' });
  if (!ENABLE_EMAIL_VERIFY) return res.status(403).json({ ok: false, error: 'ระบบ verify ปิดอยู่' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const [ok, err] = userdb.validateEmail(email);
  if (!ok) return res.status(400).json({ ok: false, error: err });

  const [ok2, err2] = userdb.setEmail(req.user, email);
  if (!ok2) return res.status(400).json({ ok: false, error: err2 });

  try {
    const { token } = verify.createVerification(req.user, email, 'verify', VERIFY_TTL);
    const send = await mailer.sendVerificationEmail(email, req.user, token);
    account.logActivity(req.user, 'email.change', email, clientIp(req), getUa(req));
    if (!send.ok) {
      return res.json({ ok: true, warning: `ส่งอีเมลไม่สำเร็จ: ${send.error}`, email });
    }
    res.json({ ok: true, message: `ส่งลิงก์ยืนยันไปที่ ${email} แล้ว`, email });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- Email: ส่งลิงก์ยืนยันใหม่ ----
app.post('/api/account/resend-verify', requireLogin, requireCsrf, async (req, res) => {
  if (!HAS_USERS) return res.status(500).json({ ok: false, error: 'ระบบไม่พร้อม' });
  if (!ENABLE_EMAIL_VERIFY) return res.status(403).json({ ok: false, error: 'ระบบ verify ปิดอยู่' });

  if (userdb.isEmailVerified(req.user)) {
    return res.json({ ok: true, already: true });
  }

  const check = verify.canResend(req.user, VERIFY_RESEND_CD, VERIFY_RESEND_MAX);
  if (!check.ok) {
    if (check.reason === 'COOLDOWN') {
      return res.status(429).json({
        ok: false,
        error: 'COOLDOWN',
        message: `กรุณารออีก ${check.wait_sec} วินาที`,
        wait_sec: check.wait_sec,
      });
    }
    return res.status(429).json({ ok: false, error: 'DAILY_LIMIT', message: `สูงสุด ${check.max} ครั้ง/วัน` });
  }

  const u = userdb.getUser(req.user);
  if (!u || !u.email) return res.status(400).json({ ok: false, error: 'ไม่พบอีเมล' });

  try {
    const { token } = verify.createVerification(req.user, u.email, 'verify', VERIFY_TTL);
    const send = await mailer.sendVerificationEmail(u.email, req.user, token);
    if (!send.ok) return res.status(500).json({ ok: false, error: send.error });
    account.logActivity(req.user, 'email.verify.resend', u.email, clientIp(req), getUa(req));
    res.json({ ok: true, message: `ส่งไปที่ ${u.email} แล้ว` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/proxy/status', (req, res) => {
  res.json({
    ok: true,
    count: proxyLoader.count(),
    file: proxyLoader.PROXY_FILE,
    sample: proxyLoader.list().slice(0, 3).map(p => p.replace(/:[^:@/]+@/, ':***@')),
  });
});

app.post('/api/proxy/reload', (req, res) => {
  if (!isCurrentAdmin(req)) return res.status(403).json({ ok: false, error: 'ไม่มีสิทธิ์' });
  proxyLoader.reload();
  res.json({ ok: true, count: proxyLoader.count() });
});

// ============================================================
// Phone: start (ส่ง OTP)
// ============================================================
app.post('/api/account/phone/start', requireLogin, async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  const [ok, normalizedPhone] = account.setPhoneUnverified(req.user, phone);
  if (!ok) return res.status(400).json({ ok: false, error: normalizedPhone });

  const r = account.createPhoneVerification(req.user, normalizedPhone, 300);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });

  let sent;
  try {
    sent = await sendOtp(r.phone, r.code);
  } catch (e) {
    account.consumePhoneVerification(r.token, '');
    return res.status(502).json({ ok: false, error: 'ส่ง OTP ไม่สำเร็จ: ' + e.message });
  }

  if (!sent.ok) {
    account.consumePhoneVerification(r.token, '');
    return res.status(502).json({
      ok: false,
      error: 'ส่ง OTP ไม่สำเร็จทุก provider',
      details: sent.errors,
    });
  }

  account.logActivity(req.user, 'phone.verify.start', r.phone, clientIp(req), getUa(req));
  console.log(`📱 OTP via ${sent.provider} → ${r.phone} (code=${r.code})`);

  res.json({
    ok: true,
    token: r.token,
    phone: r.phone,
    provider: sent.provider,
    message: 'ส่ง OTP แล้ว',
    // ★ dev/auto-fill เท่านั้น — ปลอดภัยเมื่อ NODE_ENV != production
    dev_code: process.env.NODE_ENV !== 'production' ? r.code : undefined,
  });
});

// ============================================================
// Phone: verify OTP
// ============================================================
app.post('/api/account/phone/verify', requireLogin, (req, res) => {
  const token = String(req.body?.token || '').trim();
  const code  = String(req.body?.code || '').trim();

  const r = account.consumePhoneVerification(token, code);
  if (!r.ok) {
    const map = {
      NOT_FOUND: 'ไม่พบคำขอ',
      USED: 'ใช้ไปแล้ว',
      EXPIRED: 'OTP หมดอายุ',
      WRONG_CODE: 'รหัสไม่ถูกต้อง',
      INVALID: 'ข้อมูลไม่ครบ',
    };
    return res.status(400).json({ ok: false, error: map[r.error] || 'ยืนยันไม่สำเร็จ' });
  }
  if (r.user !== req.user) {
    return res.status(403).json({ ok: false, error: 'ไม่มีสิทธิ์' });
  }

  account.markPhoneVerified(req.user);
  account.logActivity(req.user, 'phone.verify.ok', r.phone, clientIp(req), getUa(req));
  res.json({ ok: true, message: 'ยืนยันเบอร์สำเร็จ', phone: r.phone });
});

// ============================================================
// Phone: remove
// ============================================================
app.post('/api/account/phone/remove', requireLogin, requireCsrf, (req, res) => {
  account.clearPhone(req.user);
  account.logActivity(req.user, 'phone.remove', null, clientIp(req), getUa(req));
  res.json({ ok: true, message: 'ลบเบอร์แล้ว' });
});

// ---- Activity log ----
app.get('/api/account/activity', requireLogin, (req, res) => {
  const items = account.listActivity(req.user, 50).map((a) => ({
    id: a.id,
    action: a.action,
    detail: a.detail,
    ip: a.ip,
    date_text: new Date(a.ts).toLocaleString('th-TH'),
    ts: a.ts,
  }));
  res.json({ ok: true, items });
});

// ---- Delete account ----
app.post('/api/account/delete', requireLogin, requireCsrf, (req, res) => {
  if (req.user === DEFAULT_ADMIN_USER) {
    return res.status(400).json({ ok: false, error: 'ไม่สามารถลบบัญชี admin ได้' });
  }

  const password = String(req.body?.password || '');
  const confirm  = String(req.body?.confirm || '').trim();

  if (confirm !== 'DELETE') {
    return res.status(400).json({ ok: false, error: 'พิมพ์ DELETE เพื่อยืนยัน' });
  }
  if (!password) {
    return res.status(400).json({ ok: false, error: 'ต้องใส่รหัสผ่าน' });
  }

  const [ok] = userdb.verifyUser(req.user, password);
  if (!ok) {
    account.logActivity(req.user, 'account.delete.fail', 'wrong password', clientIp(req), getUa(req));
    return res.status(400).json({ ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
  }

  logger.warn(`ACCOUNT_DELETE user=${req.user} ip=${clientIp(req)}`);

  account.logActivity(req.user, 'account.delete', null, clientIp(req), getUa(req));

  try { account.deleteAccount(req.user); } catch (_) {}
  try { if (HAS_USERS) userdb.deleteUser(req.user); } catch (_) {}
  try { if (HAS_SUBS) subs.setExpires ? subs.setExpires(req.user, 0) : null; } catch (_) {}

  req.session.destroy(() => {
    res.clearCookie('keeedum.sid');
    res.json({ ok: true, message: 'ลบบัญชีแล้ว', redirect: '/login' });
  });
});

// ---- DKIM ----
app.get('/api/tools/mail/dkim', requireLogin, requireMailTools, async (req, res) => {
  checkRate(req);
  const domain = String(req.query.domain || '').trim();
  const selector = String(req.query.selector || '').trim() || null;
  if (!mailTools.isValidDomain(domain)) {
    return res.status(400).json({ ok: false, error: 'domain ไม่ถูกต้อง' });
  }
  if (selector && !/^[a-zA-Z0-9._-]{1,63}$/.test(selector)) {
    return res.status(400).json({ ok: false, error: 'selector ไม่ถูกต้อง' });
  }
  try {
    const r = await mailTools.checkDKIM(domain, selector);
    res.json({ ok: true, domain, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- MX ----
app.get('/api/tools/mail/mx', requireLogin, requireMailTools, async (req, res) => {
  checkRate(req);
  const domain = String(req.query.domain || '').trim();
  if (!mailTools.isValidDomain(domain)) {
    return res.status(400).json({ ok: false, error: 'domain ไม่ถูกต้อง' });
  }
  try {
    const r = await mailTools.resolveMx(domain);
    res.json({ ok: true, domain, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- Full mail report ----
app.get('/api/tools/mail/all', requireLogin, requireMailTools, async (req, res) => {
  checkRate(req);
  const domain = String(req.query.domain || '').trim();
  if (!mailTools.isValidDomain(domain)) {
    return res.status(400).json({ ok: false, error: 'domain ไม่ถูกต้อง' });
  }
  try {
    const r = await mailTools.fullMailReport(domain);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- WAF detection ----
app.get('/api/tools/waf', requireLogin, requireMailTools, async (req, res) => {
  checkRate(req);
  const host = String(req.query.host || '').trim();
  if (!host || !/^[a-zA-Z0-9.\-:_/]+$/.test(host)) {
    return res.status(400).json({ ok: false, error: 'host ไม่ถูกต้อง' });
  }
  try {
    const r = await mailTools.fullWAFReport(host);
    if (!r.ok) return res.status(502).json({ ok: false, error: r.error, host: r.host });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Health check ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    env: NODE_ENV,
    host: WEB_HOST,
    port: WEB_PORT,
    https: isHttps(req),
    behind_proxy: !!req.headers['x-forwarded-for'],
    client_ip: req.ip,
    uptime_sec: Math.floor(process.uptime()),
  });
});

// ─── Error handlers ───────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.status === 429) return res.status(429).json({ ok: false, error: 'คำขอมากเกินไป' });
  if (err.status === 413) return res.status(413).json({ ok: false, error: 'ข้อมูลใหญ่เกินไป' });

  console.error('\n╔══════════════════════════════════════');
  console.error('║ ❌ 500 ERROR');
  console.error('╠══════════════════════════════════════');
  console.error(`║ ${req.method} ${req.originalUrl}`);
  console.error(`║ ${err.message}`);
  console.error('╠══════════════════════════════════════');
  console.error(err.stack);
  console.error('╚══════════════════════════════════════\n');

  res.status(500).json({
    ok: false,
    error: err.message,
    path: req.originalUrl,
    stack: String(err.stack || '').split('\n').slice(0, 5),
  });
});

// ─── Helper: get LAN IP ───────────────────────────────────
function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// ─── Main ─────────────────────────────────────────────────
if (require.main === module) {
  const BANNER = '='.repeat(64);
  console.log(BANNER);
  console.log(`🌐 Host: ${WEB_HOST}  Port: ${WEB_PORT}  Env: ${NODE_ENV}`);
  console.log(`👥 ระบบสมาชิก: ${HAS_USERS ? '✅ เปิด' : '❌ ไม่มี users.js'}`);
  console.log(`📝 เปิดสมัคร: ${ALLOW_REGISTER ? '✅' : '❌'}`);
  console.log(`🛡 Admin: ${DEFAULT_ADMIN_USER}`);
  console.log(`💳 Subscription: ${SUBSCRIPTION_ENABLED && HAS_SUBS ? '✅ เปิด' : '❌ ปิด'}`);
  if (SUBSCRIPTION_ENABLED && HAS_SUBS) {
    console.log(`💰 รับเงินที่: ${PAYMENT_PHONE} (${PAYMENT_NAME})`);
  }
  console.log(`📁 โฟลเดอร์ที่อนุญาต: ${ALLOWED_ROOTS.join(', ')}`);
  console.log(`🧠 AI API URL: ${API_URL}`);
  console.log(`🔑 API_KEY: ${API_KEY ? '✅ มี' : '❌ ไม่มี'}`);
  console.log(`📄 prompt.txt: ${fs.existsSync(PROMPT_FILE) ? '✅ มี' : '❌ ไม่มี'}`);
  console.log(`🎭 personas.txt: ${fs.existsSync(PERSONAS_FILE) ? '✅ มี' : '❌ ไม่มี'}`);
  console.log(`🔒 Trust proxy: ${TRUST_PROXY}  |  Cookie sameSite: ${COOKIE_SAMESITE}`);
  console.log(`🔐 Force HTTPS: ${FORCE_HTTPS ? '✅' : '❌'}`);
  console.log(BANNER);

  const server = app.listen(WEB_PORT, WEB_HOST, { exclusive: false }, () => {
    const lanIp = getLanIp();
    console.log(`🚀 Listening on http://${WEB_HOST}:${WEB_PORT}`);
    console.log(`🏠 Local:   http://localhost:${WEB_PORT}`);
    console.log(`🌍 LAN:     http://${lanIp}:${WEB_PORT}`);
    if (IS_PROD) {
      console.log(`☁️  HTTPS:   https://<your-domain>  (หลัง proxy)`);
    } else {
      console.log(`☁️  Cloudflared: cloudflared tunnel --url http://localhost:${WEB_PORT}`);
    }
    console.log(BANNER);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${WEB_PORT} ถูกใช้อยู่`);
      console.error(`   วิธีแก้:`);
      console.error(`   - หา process:  sudo ss -tlnp | grep ${WEB_PORT}`);
      console.error(`   - kill:        sudo kill <PID>`);
      console.error(`   - หรือเปลี่ยน: AI_WEB_PORT=3001 node server.js\n`);
    } else if (err.code === 'EACCES') {
      console.error(`\n❌ ไม่มีสิทธิ์ผูก port ${WEB_PORT} (ต่ำกว่า 1024 ต้อง sudo)`);
      console.error(`   แนะนำใช้ port สูง (3000, 8000, 8080) แทน\n`);
    } else {
      console.error(`\n❌ listen error: ${err.message}\n`);
    }
    process.exit(1);
  });

  function shutdown(sig) {
    console.log(`\n[${sig}] กำลังปิด server...`);
    server.close(() => {
      console.log('[+] ปิดเรียบร้อย');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[!] timeout — บังคับปิด');
      process.exit(1);
    }, 5000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (e) => {
    console.error(`[UNCAUGHT] ${e.stack || e.message}`);
  });
  process.on('unhandledRejection', (e) => {
    console.error(`[UNHANDLED_REJECTION] ${e && e.stack ? e.stack : e}`);
  });
}

module.exports = app;