// language: JavaScript, file: db.js
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// ============================================================
// Config
// ============================================================
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.sqlite');
const dir = path.dirname(DB_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// ============================================================
// Connection
// ============================================================
let db;
function getDb() {
  if (db) return db;
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

// ============================================================
// Schema
// ============================================================
function initSchema() {
  const conn = getDb();

  conn.exec(`
    -- ============ USERS (mirror) ============
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT UNIQUE NOT NULL,
      email           TEXT,
      password_hash   TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'user',
      email_verified  INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      last_login      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);

    -- ============ USER PROFILE ============
    CREATE TABLE IF NOT EXISTS user_profile (
      user           TEXT PRIMARY KEY,
      phone          TEXT,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      display_name   TEXT,
      avatar         TEXT,
      bio            TEXT,
      updated_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profile_phone ON user_profile(phone);

    -- ============ EMAIL VERIFICATIONS ============
    CREATE TABLE IF NOT EXISTS email_verifications (
      token       TEXT PRIMARY KEY,
      username    TEXT NOT NULL,
      email       TEXT NOT NULL,
      purpose     TEXT NOT NULL DEFAULT 'verify',
      expires_at  INTEGER NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_verify_user ON email_verifications(username);
    CREATE INDEX IF NOT EXISTS idx_verify_exp  ON email_verifications(expires_at);

    -- ============ PHONE VERIFICATIONS ============
    CREATE TABLE IF NOT EXISTS phone_verifications (
      token      TEXT PRIMARY KEY,
      user       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      code       TEXT NOT NULL,
      purpose    TEXT NOT NULL DEFAULT 'verify_phone',
      expires_at INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_phone_verify_user ON phone_verifications(user);
    CREATE INDEX IF NOT EXISTS idx_phone_verify_exp  ON phone_verifications(expires_at);

    -- ============ ACTIVITY LOG ============
    CREATE TABLE IF NOT EXISTS activity_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user    TEXT NOT NULL,
      action  TEXT NOT NULL,
      detail  TEXT,
      ip      TEXT,
      ua      TEXT,
      ts      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user, ts);
    CREATE INDEX IF NOT EXISTS idx_activity_ts   ON activity_log(ts);

    -- ============ SESSIONS ============
    CREATE TABLE IF NOT EXISTS sessions (
      sid         TEXT PRIMARY KEY,
      user        TEXT NOT NULL,
      csrf        TEXT NOT NULL,
      ip          TEXT,
      ua          TEXT,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- ============ SUBSCRIPTIONS ============
    CREATE TABLE IF NOT EXISTS subscriptions (
      user        TEXT PRIMARY KEY,
      expires_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    -- ============ PURCHASES ============
    CREATE TABLE IF NOT EXISTS purchases (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user         TEXT NOT NULL,
      package_key  TEXT NOT NULL,
      price        REAL NOT NULL,
      method       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      slip         TEXT,
      admin_note   TEXT,
      created_at   INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_user   ON purchases(user);
    CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
    CREATE INDEX IF NOT EXISTS idx_purchases_ts     ON purchases(created_at);

    -- ============ API KEYS ============
    CREATE TABLE IF NOT EXISTS keys (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key      TEXT UNIQUE NOT NULL,
      plan         TEXT NOT NULL,
      daily_limit  INTEGER NOT NULL,
      per_min      INTEGER NOT NULL,
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      revoked      INTEGER NOT NULL DEFAULT 0,
      owner        TEXT,
      label        TEXT,
      last_ip      TEXT,
      last_used    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_keys_key   ON keys(api_key);
    CREATE INDEX IF NOT EXISTS idx_keys_owner ON keys(owner);

    -- ============ USAGE (quota) ============
    CREATE TABLE IF NOT EXISTS usage_daily (
      api_key TEXT NOT NULL,
      day     TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (api_key, day)
    );
    CREATE TABLE IF NOT EXISTS usage_minute (
      api_key TEXT NOT NULL,
      minute  TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (api_key, minute)
    );

    -- ============ REQUEST LOG ============
    CREATE TABLE IF NOT EXISTS requests (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key    TEXT,
      citizen_id TEXT,
      status     TEXT,
      ip         TEXT,
      ts         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_requests_ts     ON requests(ts);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

    -- ============ LOGIN ATTEMPTS ============
    CREATE TABLE IF NOT EXISTS login_attempts (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      ip       TEXT NOT NULL,
      success  INTEGER NOT NULL,
      ts       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_ip_ts   ON login_attempts(ip, ts);
    CREATE INDEX IF NOT EXISTS idx_login_user_ts ON login_attempts(username, ts);

    -- ============ AUDIT LOG ============
    CREATE TABLE IF NOT EXISTS audit_log (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      user   TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      ip     TEXT,
      ts     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
  `);
}

// ============================================================
// Cleanup
// ============================================================
function cleanExpiredSessions() {
  return getDb()
    .prepare(`DELETE FROM sessions WHERE expires_at < ?`)
    .run(Date.now()).changes;
}

function cleanExpiredVerifications() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return getDb()
    .prepare(`DELETE FROM email_verifications WHERE expires_at < ?`)
    .run(cutoff).changes;
}

function cleanExpiredPhoneVerifications() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return getDb()
    .prepare(`DELETE FROM phone_verifications WHERE expires_at < ?`)
    .run(cutoff).changes;
}

function cleanOldActivityLog(days = 90) {
  const cutoff = Date.now() - days * 86400_000;
  return getDb()
    .prepare(`DELETE FROM activity_log WHERE ts < ?`)
    .run(cutoff).changes;
}

function cleanOldUsage(days = 30) {
  const cutoff = new Date(Date.now() - days * 86400_000)
    .toISOString().slice(0, 10);
  const a = getDb()
    .prepare(`DELETE FROM usage_daily WHERE day < ?`)
    .run(cutoff).changes;
  const b = getDb()
    .prepare(`DELETE FROM usage_minute WHERE minute < ?`)
    .run(cutoff + 'T00:00').changes;
  return a + b;
}

function cleanOldRequests(days = 90) {
  const cutoff = Date.now() - days * 86400_000;
  return getDb()
    .prepare(`DELETE FROM requests WHERE ts < ?`)
    .run(cutoff).changes;
}

function cleanOldLoginAttempts(hours = 48) {
  const cutoff = Date.now() - hours * 3600_000;
  return getDb()
    .prepare(`DELETE FROM login_attempts WHERE ts < ?`)
    .run(cutoff).changes;
}

// ============================================================
// Stats
// ============================================================
function stats() {
  const c = getDb();
  return {
    total_requests:    c.prepare(`SELECT COUNT(*) c FROM requests`).get().c,
    last_24h:          c.prepare(`SELECT COUNT(*) c FROM requests WHERE ts >= ?`)
                        .get(Date.now() - 86400_000).c,
    hits:              c.prepare(`SELECT COUNT(*) c FROM requests WHERE status='hit'`).get().c,
    active_keys:       c.prepare(`SELECT COUNT(*) c FROM keys WHERE revoked=0 AND expires_at > ?`)
                        .get(Date.now()).c,
    total_users:       c.prepare(`SELECT COUNT(*) c FROM users`).get().c,
    pending_purchases: c.prepare(`SELECT COUNT(*) c FROM purchases WHERE status='pending'`).get().c,
  };
}

// ============================================================
// Audit
// ============================================================
function audit({ user, action, detail, ip }) {
  getDb().prepare(`
    INSERT INTO audit_log (user, action, detail, ip, ts) VALUES (?,?,?,?,?)
  `).run(user || null, action, detail || null, ip || null, Date.now());
}

// ============================================================
// Transaction
// ============================================================
function tx(fn) {
  return getDb().transaction(fn);
}

// ============================================================
// Bootstrap
// ============================================================
initSchema();
try { cleanExpiredSessions(); } catch (_) {}
try { cleanExpiredVerifications(); } catch (_) {}
try { cleanExpiredPhoneVerifications(); } catch (_) {}

// ============================================================
// Exports
// ============================================================
module.exports = {
  DB_FILE,
  getDb,
  initSchema,
  tx,
  stats,
  audit,
  cleanExpiredSessions,
  cleanExpiredVerifications,
  cleanExpiredPhoneVerifications,
  cleanOldActivityLog,
  cleanOldUsage,
  cleanOldRequests,
  cleanOldLoginAttempts,
};