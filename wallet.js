// ============================================================
// wallet.js — ระบบกระเป๋าเงิน
// ============================================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'database');
fs.mkdirSync(DB_DIR, { recursive: true });
const DB_FILE = path.join(DB_DIR, 'wallet.db');

const RATE_BAHT_PER_DAY = 10;
const SECONDS_PER_DAY = 86400;

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
    CREATE TABLE IF NOT EXISTS wallets (
      user        TEXT PRIMARY KEY,
      balance     REAL NOT NULL DEFAULT 0,
      total_topup REAL NOT NULL DEFAULT 0,
      created_at  REAL NOT NULL,
      updated_at  REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS topups (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user         TEXT NOT NULL,
      voucher_code TEXT,
      amount       REAL NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      error_msg    TEXT,
      created_at   REAL NOT NULL,
      completed_at REAL
    );
  `);
}

function getWallet(user) {
  const conn = getDb();
  let row = conn.prepare('SELECT * FROM wallets WHERE user = ?').get(user);
  if (!row) {
    const now = Date.now() / 1000;
    conn.prepare(
      'INSERT INTO wallets (user, balance, total_topup, created_at, updated_at) VALUES (?, 0, 0, ?, ?)'
    ).run(user, now, now);
    row = conn.prepare('SELECT * FROM wallets WHERE user = ?').get(user);
  }
  return row || null;
}

function addBalance(user, amount) {
  const conn = getDb();
  const w = getWallet(user);
  const newBalance = w.balance + amount;
  const newTotal = w.total_topup + amount;
  conn.prepare(
    'UPDATE wallets SET balance = ?, total_topup = ?, updated_at = ? WHERE user = ?'
  ).run(newBalance, newTotal, Date.now() / 1000, user);
  return newBalance;
}

function deductBalance(user, amount) {
  const conn = getDb();
  const w = getWallet(user);
  if (w.balance < amount) return [false, 'ยอดเงินไม่พอ', w.balance];
  const newBalance = w.balance - amount;
  conn.prepare(
    'UPDATE wallets SET balance = ?, updated_at = ? WHERE user = ?'
  ).run(newBalance, Date.now() / 1000, user);
  return [true, '', newBalance];
}

function createTopup(user, voucherCode = null, amount = 0) {
  const conn = getDb();
  const info = conn.prepare(`
    INSERT INTO topups (user, voucher_code, amount, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(user, voucherCode, amount, Date.now() / 1000);
  return info.lastInsertRowid;
}

function completeTopup(pid, amount, error = null) {
  const conn = getDb();
  if (error) {
    conn.prepare(
      "UPDATE topups SET status = 'failed', error_msg = ?, completed_at = ? WHERE id = ?"
    ).run(error, Date.now() / 1000, pid);
  } else {
    conn.prepare(
      "UPDATE topups SET status = 'success', amount = ?, completed_at = ? WHERE id = ?"
    ).run(amount, Date.now() / 1000, pid);
  }
}

function listTopups(user, limit = 20) {
  const conn = getDb();
  return conn.prepare(
    'SELECT * FROM topups WHERE user = ? ORDER BY created_at DESC LIMIT ?'
  ).all(user, limit);
}

function canExchange(user, days) {
  const cost = days * RATE_BAHT_PER_DAY;
  const w = getWallet(user);
  return [w.balance >= cost, cost, w.balance];
}

function calcDaysFromBalance(balance) {
  return Math.floor(balance / RATE_BAHT_PER_DAY);
}

module.exports = {
  DB_FILE,
  RATE_BAHT_PER_DAY,
  SECONDS_PER_DAY,
  initDb,
  getWallet,
  addBalance,
  deductBalance,
  createTopup,
  completeTopup,
  listTopups,
  canExchange,
  calcDaysFromBalance,
};