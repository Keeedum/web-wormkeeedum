// ============================================================
// subscriptions.js — จัดการเวลาการใช้งาน (subscription)
// ============================================================
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const BASE = __dirname;
const DB_DIR = path.join(BASE, 'database');
fs.mkdirSync(DB_DIR, { recursive: true });
const DB_FILE = path.join(DB_DIR, 'subscriptions.db');

const UPLOAD_DIR = path.join(BASE, 'static', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PAYMENT_PHONE = process.env.PAYMENT_PHONE || '0953167272';
const PAYMENT_NAME  = process.env.PAYMENT_NAME  || 'Keeedum AI';

const PACKAGES = {
  '1day':  { name: '1 วัน',  price: 10,  seconds: 1  * 24 * 3600 },
  '3day':  { name: '3 วัน',  price: 25,  seconds: 3  * 24 * 3600 },
  '7day':  { name: '7 วัน',  price: 50,  seconds: 7  * 24 * 3600 },
  '30day': { name: '30 วัน', price: 180, seconds: 30 * 24 * 3600 },
};

let db;
function getDb() {
  if (!db) {
    db = new Database(DB_FILE);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initDb() {
  const conn = getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user       TEXT PRIMARY KEY,
      expires_at REAL NOT NULL DEFAULT 0,
      total_paid REAL NOT NULL DEFAULT 0,
      created_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user         TEXT NOT NULL,
      package      TEXT NOT NULL,
      price        REAL NOT NULL,
      seconds      INTEGER NOT NULL,
      purchased_at REAL NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      slip_file    TEXT,
      admin_note   TEXT,
      approved_at  REAL
    );
  `);
}

function getUser(user) {
  const conn = getDb();
  let row = conn.prepare('SELECT * FROM users WHERE user = ?').get(user);
  if (!row) {
    const now = Date.now() / 1000;
    conn.prepare(
      'INSERT INTO users (user, expires_at, total_paid, created_at) VALUES (?, 0, 0, ?)'
    ).run(user, now);
    row = conn.prepare('SELECT * FROM users WHERE user = ?').get(user);
  }
  return row || null;
}

function getRemaining(user) {
  const u = getUser(user);
  if (!u) return 0;
  return Math.max(0, u.expires_at - Date.now() / 1000);
}

function isActive(user) {
  return getRemaining(user) > 0;
}

function addTime(user, seconds) {
  const conn = getDb();
  const u = getUser(user);
  const base = Math.max(Date.now() / 1000, u.expires_at);
  const newExp = base + seconds;
  conn.prepare('UPDATE users SET expires_at = ? WHERE user = ?').run(newExp, user);
  return newExp;
}

function setExpires(user, expiresAt) {
  const conn = getDb();
  const exists = conn.prepare('SELECT user FROM users WHERE user = ?').get(user);
  if (exists) {
    conn.prepare('UPDATE users SET expires_at = ? WHERE user = ?').run(expiresAt, user);
  } else {
    conn.prepare(
      'INSERT INTO users (user, expires_at, total_paid, created_at) VALUES (?, ?, 0, ?)'
    ).run(user, expiresAt, Date.now() / 1000);
  }
  return expiresAt;
}

function removeTime(user, seconds) {
  const conn = getDb();
  const u = getUser(user);
  if (!u) throw new Error('ไม่พบ user');
  const newExp = Math.max(Date.now() / 1000, u.expires_at - seconds);
  conn.prepare('UPDATE users SET expires_at = ? WHERE user = ?').run(newExp, user);
  return newExp;
}

function resetTime(user) {
  const conn = getDb();
  conn.prepare('UPDATE users SET expires_at = 0 WHERE user = ?').run(user);
  return 0;
}

function listAllUsersStats(limit = 500) {
  const conn = getDb();
  const rows = conn.prepare(`
    SELECT user, expires_at, total_paid, created_at
    FROM users ORDER BY created_at DESC LIMIT ?
  `).all(limit);
  const now = Date.now() / 1000;
  return rows.map(r => {
    const rem = Math.max(0, r.expires_at - now);
    return {
      user: r.user,
      remaining: Math.floor(rem),
      remaining_text: fmtTime(rem),
      expires_at: r.expires_at,
      total_paid: r.total_paid,
      created_at: r.created_at,
      is_active: rem > 0,
    };
  });
}

function logAdminAction(adminUser, targetUser, seconds, note = '') {
  try {
    const conn = getDb();
    const info = conn.prepare(`
      INSERT INTO purchases
        (user, package, price, seconds, purchased_at, status, slip_file, admin_note, approved_at)
      VALUES (?, 'admin_gift', 0, ?, ?, 'approved', ?, ?, ?)
    `).run(
      targetUser,
      seconds,
      Date.now() / 1000,
      `admin:${adminUser}`,
      note || `admin ${adminUser} เพิ่มเวลา`,
      Date.now() / 1000
    );
    return info.lastInsertRowid;
  } catch (e) {
    console.error('logAdminAction error:', e.message);
    return null;
  }
}

function createPending(user, packageKey, slipFilename = null) {
  if (!(packageKey in PACKAGES) && packageKey !== 'admin_gift')
    throw new Error('แพ็กเกจไม่ถูกต้อง');

  const pkg = packageKey === 'admin_gift'
    ? { name: 'ของขวัญ', price: 0, seconds: 0 }
    : PACKAGES[packageKey];

  const conn = getDb();
  const info = conn.prepare(`
    INSERT INTO purchases (user, package, price, seconds, purchased_at, status, slip_file)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(user, packageKey, pkg.price, pkg.seconds, Date.now() / 1000, slipFilename);

  return info.lastInsertRowid;
}

function listPending() {
  const conn = getDb();
  return conn.prepare(
    "SELECT * FROM purchases WHERE status = 'pending' ORDER BY purchased_at ASC"
  ).all();
}

function listPurchases(user, limit = 20) {
  const conn = getDb();
  return conn.prepare(
    'SELECT * FROM purchases WHERE user = ? ORDER BY purchased_at DESC LIMIT ?'
  ).all(user, limit);
}

function approvePurchase(pid, adminNote = '') {
  const conn = getDb();
  const row = conn.prepare('SELECT * FROM purchases WHERE id = ?').get(pid);
  if (!row) throw new Error('ไม่พบรายการ');
  if (row.status !== 'pending') throw new Error(`สถานะเป็น ${row.status} แล้ว`);

  const u = getUser(row.user);
  const base = Math.max(Date.now() / 1000, u.expires_at);
  const newExp = base + row.seconds;

  const tx = conn.transaction(() => {
    conn.prepare(
      'UPDATE users SET expires_at = ?, total_paid = total_paid + ? WHERE user = ?'
    ).run(newExp, row.price, row.user);
    conn.prepare(
      "UPDATE purchases SET status = 'approved', admin_note = ?, approved_at = ? WHERE id = ?"
    ).run(adminNote, Date.now() / 1000, pid);
  });
  tx();
  return newExp;
}

function rejectPurchase(pid, adminNote = '') {
  const conn = getDb();
  conn.prepare(
    "UPDATE purchases SET status = 'rejected', admin_note = ? WHERE id = ?"
  ).run(adminNote, pid);
}

function genSlipFilename(user, ext = '.jpg') {
  const rand = crypto.randomBytes(8).toString('hex');
  const safeUser = String(user).replace(/[^a-zA-Z0-9\-_]/g, '');
  return `${safeUser}_${Math.floor(Date.now() / 1000)}_${rand}${ext}`;
}

function fmtTime(seconds) {
  if (seconds <= 0) return 'หมดอายุ';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d) parts.push(`${d} วัน`);
  if (h) parts.push(`${h} ชม.`);
  if (m) parts.push(`${m} นาที`);
  if (s && !d && !h) parts.push(`${s} วิ`);
  return parts.length ? parts.join(' ') : '0 วิ';
}

module.exports = {
  DB_FILE,
  UPLOAD_DIR,
  PACKAGES,
  PAYMENT_PHONE,
  PAYMENT_NAME,
  initDb,
  getUser,
  getRemaining,
  isActive,
  addTime,
  setExpires,
  removeTime,
  resetTime,
  listAllUsersStats,
  logAdminAction,
  createPending,
  listPending,
  listPurchases,
  approvePurchase,
  rejectPurchase,
  genSlipFilename,
  fmtTime,
};