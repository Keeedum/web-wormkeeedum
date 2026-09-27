// language: JavaScript, file: verify.js
'use strict';

const crypto = require('crypto');
const db = require('./db');

const conn = db.getDb();

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// ============================================================
// Create
// ============================================================
function createVerification(username, email, purpose = 'verify', ttlSec = 3600) {
  const now = Date.now();
  const expires = now + ttlSec * 1000;

  // ยกเลิก token เก่าทั้งหมดของ user + purpose เดียวกัน
  conn.prepare(`
    UPDATE email_verifications SET used = 1
     WHERE username = ? AND purpose = ? AND used = 0
  `).run(username, purpose);

  const token = generateToken();
  conn.prepare(`
    INSERT INTO email_verifications (token, username, email, purpose, expires_at, created_at)
    VALUES (?,?,?,?,?,?)
  `).run(token, username, String(email).toLowerCase(), purpose, expires, now);

  return { token, expires_at: expires };
}

// ============================================================
// Consume
// ============================================================
function consumeToken(token, purpose = 'verify') {
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'INVALID', message: 'token ไม่ถูกต้อง' };
  }

  const row = conn.prepare(`
    SELECT * FROM email_verifications WHERE token = ? AND purpose = ?
  `).get(token, purpose);

  if (!row) return { ok: false, error: 'NOT_FOUND', message: 'ไม่พบ token นี้' };
  if (row.used) return { ok: false, error: 'USED', message: 'token นี้ถูกใช้ไปแล้ว' };
  if (row.expires_at < Date.now()) return { ok: false, error: 'EXPIRED', message: 'token หมดอายุ' };

  conn.prepare(`UPDATE email_verifications SET used = 1 WHERE token = ?`).run(token);

  return {
    ok: true,
    username: row.username,
    email: row.email,
    purpose: row.purpose,
  };
}

// ============================================================
// Rate limit resend
// ============================================================
function canResend(username, cooldownSec, maxPerDay) {
  const since = Date.now() - 24 * 3600 * 1000;

  const last = conn.prepare(`
    SELECT MAX(created_at) AS t FROM email_verifications
     WHERE username = ? AND purpose = 'verify'
  `).get(username);

  if (last && last.t) {
    const diff = (Date.now() - last.t) / 1000;
    if (diff < cooldownSec) {
      return {
        ok: false,
        reason: 'COOLDOWN',
        wait_sec: Math.ceil(cooldownSec - diff),
      };
    }
  }

  const cnt = conn.prepare(`
    SELECT COUNT(*) AS n FROM email_verifications
     WHERE username = ? AND purpose = 'verify' AND created_at >= ?
  `).get(username, since);

  if (cnt && cnt.n >= maxPerDay) {
    return { ok: false, reason: 'DAILY_LIMIT', max: maxPerDay };
  }

  return { ok: true };
}

// ============================================================
// Housekeeping
// ============================================================
function cleanExpired() {
  return conn.prepare(`DELETE FROM email_verifications WHERE expires_at < ?`)
    .run(Date.now() - 86400_000).changes;
}

module.exports = {
  createVerification,
  consumeToken,
  canResend,
  cleanExpired,
};