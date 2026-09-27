// ============================================================
// daily_reward.js — แจกเวลาฟรีวันละ 1 ชั่วโมง (TZ UTC+7)
// ============================================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'database');
fs.mkdirSync(DB_DIR, { recursive: true });
const DB_FILE = path.join(DB_DIR, 'daily_reward.db');

const REWARD_SECONDS = 3600;
const TZ_OFFSET_MS = 7 * 3600 * 1000; // UTC+7

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
    CREATE TABLE IF NOT EXISTS daily_claims (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user        TEXT NOT NULL,
      claim_date  TEXT NOT NULL,
      seconds     INTEGER NOT NULL,
      claimed_at  REAL NOT NULL,
      UNIQUE(user, claim_date)
    );
    CREATE INDEX IF NOT EXISTS idx_user_date ON daily_claims(user, claim_date);
  `);
}

// ─── Date helpers (TZ UTC+7) ──────────────────────────────
function todayStr() {
  const now = new Date(Date.now() + TZ_OFFSET_MS);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hasClaimedToday(user) {
  const conn = getDb();
  const row = conn.prepare(
    'SELECT 1 FROM daily_claims WHERE user = ? AND claim_date = ?'
  ).get(user, todayStr());
  return !!row;
}

function claimReward(user) {
  const date = todayStr();

  if (hasClaimedToday(user)) {
    return [false, 'วันนี้คุณรับรางวัลไปแล้ว', 0, null];
  }

  const conn = getDb();
  try {
    conn.prepare(`
      INSERT INTO daily_claims (user, claim_date, seconds, claimed_at)
      VALUES (?, ?, ?, ?)
    `).run(user, date, REWARD_SECONDS, Date.now() / 1000);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return [false, 'วันนี้คุณรับรางวัลไปแล้ว', 0, null];
    }
    return [false, `เกิดข้อผิดพลาด: ${e.message}`, 0, null];
  }

  let newExp = null;
  try {
    const subs = require('./subscriptions');
    newExp = subs.addTime(user, REWARD_SECONDS);
  } catch (e) {
    console.log('[DAILY] addTime error:', e.message);
  }

  return [true, 'รับสำเร็จ! +1 ชั่วโมง', REWARD_SECONDS, newExp];
}

function getNextResetSeconds() {
  // เวลาจนถึงเที่ยงคืนตามเวลาไทย
  const nowMs = Date.now() + TZ_OFFSET_MS;
  const now = new Date(nowMs);
  const tomorrow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  );
  return Math.max(0, Math.floor((tomorrow - nowMs) / 1000));
}

function getStats(user) {
  const conn = getDb();
  const total = conn.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(seconds), 0) AS s FROM daily_claims WHERE user = ?'
  ).get(user);
  const last = conn.prepare(
    'SELECT * FROM daily_claims WHERE user = ? ORDER BY claimed_at DESC LIMIT 1'
  ).get(user);

  return {
    total_claims: total.n || 0,
    total_seconds: total.s || 0,
    last_claim: last || null,
    claimed_today: hasClaimedToday(user),
    next_reset: getNextResetSeconds(),
  };
}

function listClaims(user, limit = 30) {
  const conn = getDb();
  return conn.prepare(`
    SELECT * FROM daily_claims WHERE user = ? ORDER BY claimed_at DESC LIMIT ?
  `).all(user, limit);
}

function fmtTime(seconds) {
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

module.exports = {
  DB_FILE,
  REWARD_SECONDS,
  initDb,
  todayStr,
  hasClaimedToday,
  claimReward,
  getNextResetSeconds,
  getStats,
  listClaims,
  fmtTime,
};