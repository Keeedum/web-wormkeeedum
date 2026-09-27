// ============================================================
// users.js — สมัคร, login, hash รหัสผ่าน (PBKDF2-SHA256)
// + email + email_verified
// ============================================================
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'database');
fs.mkdirSync(DB_DIR, { recursive: true });
const DB_FILE = path.join(DB_DIR, 'users.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_FILE);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

// ============================================================
// INIT DB (พร้อม migration)
// ============================================================
function initDb() {
  const conn = getDb();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username       TEXT PRIMARY KEY,
      password_hash  TEXT NOT NULL,
      salt           TEXT NOT NULL,
      created_at     REAL NOT NULL,
      last_login     REAL,
      is_admin       INTEGER NOT NULL DEFAULT 0
    )
  `);

  const cols = conn.prepare("PRAGMA table_info(users)").all().map((c) => c.name);

  if (!cols.includes('email')) {
    conn.exec("ALTER TABLE users ADD COLUMN email TEXT");
    conn.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email " +
      "ON users(email) WHERE email IS NOT NULL"
    );
    console.log('[INIT] ✅ เพิ่มคอลัมน์ email');
  }

  if (!cols.includes('email_verified')) {
    // ผู้ใช้เดิมให้ถือว่ายืนยันแล้ว ไม่ต้องโดนบล็อก
    conn.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    conn.exec("UPDATE users SET email_verified = 1 WHERE email IS NOT NULL");
    console.log('[INIT] ✅ เพิ่มคอลัมน์ email_verified');
  }
}

// ============================================================
// HASH
// ============================================================
function hashPassword(password, saltBuf = null) {
  const salt = saltBuf || crypto.randomBytes(16);
  const dk = crypto.pbkdf2Sync(password, salt, 200_000, 32, 'sha256');
  return { hash: dk.toString('hex'), salt: salt.toString('hex') };
}

function verifyPassword(password, hashHex, saltHex) {
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const dk = crypto.pbkdf2Sync(password, salt, 200_000, 32, 'sha256');
    return crypto.timingSafeEqual(dk, expected);
  } catch (_) {
    return false;
  }
}

// ============================================================
// VALIDATION
// ============================================================
function validateUsername(name) {
  if (!name) return [false, 'กรุณากรอกชื่อผู้ใช้'];
  if (name.length < 3) return [false, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร'];
  if (name.length > 32) return [false, 'ชื่อผู้ใช้ต้องไม่เกิน 32 ตัวอักษร'];
  if (!/^[a-zA-Z0-9_\-\u0E00-\u0E7F]+$/.test(name))
    return [false, 'ใช้ได้แค่ ตัวอักษร ตัวเลข _ - และภาษาไทย'];
  return [true, ''];
}

function validatePassword(pw) {
  if (!pw) return [false, 'กรุณากรอกรหัสผ่าน'];
  if (pw.length < 6) return [false, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'];
  if (pw.length > 128) return [false, 'รหัสผ่านต้องไม่เกิน 128 ตัวอักษร'];
  return [true, ''];
}

function validateEmail(email) {
  if (!email) return [false, 'กรุณากรอกอีเมล'];
  email = String(email).trim().toLowerCase();
  if (email.length < 5) return [false, 'อีเมลสั้นเกินไป'];
  if (email.length > 254) return [false, 'อีเมลยาวเกินไป'];
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email))
    return [false, 'รูปแบบอีเมลไม่ถูกต้อง'];
  return [true, ''];
}

// ============================================================
// CRUD
// ============================================================
function createUser(username, password, isAdmin = false, email = null) {
  let [ok, err] = validateUsername(username);
  if (!ok) return [false, err];

  [ok, err] = validatePassword(password);
  if (!ok) return [false, err];

  if (!email) return [false, 'กรุณากรอกอีเมล'];
  [ok, err] = validateEmail(email);
  if (!ok) return [false, err];

  email = String(email).trim().toLowerCase();
  username = String(username).trim();

  const conn = getDb();

  const existing = conn.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (existing) return [false, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว'];

  const dup = conn.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (dup) return [false, 'อีเมลนี้ถูกใช้แล้ว'];

  try {
    const { hash, salt } = hashPassword(password);
    conn.prepare(`
      INSERT INTO users (username, password_hash, salt, created_at, is_admin, email, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(username, hash, salt, Date.now() / 1000, isAdmin ? 1 : 0, email);
    return [true, ''];
  } catch (e) {
    return [false, `เกิดข้อผิดพลาด: ${e.message}`];
  }
}

function verifyUser(usernameOrEmail, password) {
  if (!usernameOrEmail || !password) {
    return [false, 'กรุณากรอกข้อมูลให้ครบ', null];
  }

  const conn = getDb();
  const id = String(usernameOrEmail).trim();
  const emailLower = id.toLowerCase();

  // หา user ด้วย username ก่อน ถ้าไม่เจอหาด้วย email
  let row = conn.prepare('SELECT * FROM users WHERE username = ?').get(id);
  if (!row) {
    row = conn.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(emailLower);
  }

  if (!row) return [false, 'ชื่อผู้ใช้/อีเมล หรือรหัสผ่านไม่ถูกต้อง', null];

  if (!verifyPassword(password, row.password_hash, row.salt))
    return [false, 'ชื่อผู้ใช้/อีเมล หรือรหัสผ่านไม่ถูกต้อง', null];

  conn.prepare('UPDATE users SET last_login = ? WHERE username = ?')
      .run(Date.now() / 1000, row.username);

  return [true, '', {
    username: row.username,
    email: row.email || null,
    email_verified: !!row.email_verified,
    is_admin: !!row.is_admin,
    created_at: row.created_at,
    last_login: row.last_login,
  }];
}

function getUser(username) {
  const conn = getDb();
  const row = conn.prepare(
    'SELECT username, email, email_verified, created_at, last_login, is_admin ' +
    'FROM users WHERE username = ?'
  ).get(username);
  return row || null;
}

function findByEmail(email) {
  const conn = getDb();
  const row = conn.prepare(
    'SELECT username, email, email_verified, created_at, last_login, is_admin ' +
    'FROM users WHERE LOWER(email) = ?'
  ).get(String(email).trim().toLowerCase());
  return row || null;
}

function userExists(username) {
  return !!getUser(username);
}

function countUsers() {
  const conn = getDb();
  return conn.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function listUsers() {
  const conn = getDb();
  return conn.prepare(
    'SELECT username, email, email_verified, created_at, last_login, is_admin ' +
    'FROM users ORDER BY created_at'
  ).all();
}

function get_all_users() {
  return listUsers();
}

function changePassword(username, oldPassword, newPassword) {
  const [ok] = verifyUser(username, oldPassword);
  if (!ok) return [false, 'รหัสผ่านเดิมไม่ถูกต้อง'];

  const [ok2, err2] = validatePassword(newPassword);
  if (!ok2) return [false, err2];

  const { hash, salt } = hashPassword(newPassword);
  const conn = getDb();
  conn.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE username = ?')
      .run(hash, salt, username);
  return [true, ''];
}

function deleteUser(username) {
  const conn = getDb();
  conn.prepare('DELETE FROM users WHERE username = ?').run(username);
  return [true, ''];
}

function setEmailVerified(username, verified = true) {
  const conn = getDb();
  conn.prepare('UPDATE users SET email_verified = ? WHERE username = ?')
    .run(verified ? 1 : 0, username);
}

function isEmailVerified(username) {
  const conn = getDb();
  const row = conn.prepare('SELECT email_verified FROM users WHERE username = ?').get(username);
  return !!(row && row.email_verified);
}

function setEmail(username, email) {
  const conn = getDb();
  email = String(email || '').trim().toLowerCase();
  const [ok, err] = validateEmail(email);
  if (!ok) return [false, err];

  const dup = conn.prepare('SELECT 1 FROM users WHERE email = ? AND username != ?').get(email, username);
  if (dup) return [false, 'อีเมลนี้ถูกใช้แล้ว'];

  conn.prepare('UPDATE users SET email = ?, email_verified = 0 WHERE username = ?').run(email, username);
  return [true, ''];
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  DB_FILE,
  initDb,
  hashPassword,
  verifyPassword,
  validateUsername,
  validatePassword,
  validateEmail,
  createUser,
  verifyUser,
  getUser,
  findByEmail,
  userExists,
  countUsers,
  listUsers,
  get_all_users,
  changePassword,
  deleteUser,
  setEmailVerified,
  isEmailVerified,
  setEmail,
};