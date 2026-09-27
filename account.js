// language: JavaScript, file: account.js
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const conn = db.getDb();

// ============================================================
// Profile
// ============================================================
function getProfile(user) {
  let row = conn.prepare(`SELECT * FROM user_profile WHERE user = ?`).get(user);
  if (!row) {
    const now = Date.now();
    conn.prepare(`
      INSERT INTO user_profile (user, phone, phone_verified, display_name, updated_at)
      VALUES (?, NULL, 0, NULL, ?)
    `).run(user, now);
    row = conn.prepare(`SELECT * FROM user_profile WHERE user = ?`).get(user);
  }
  return row;
}

function updateProfile(user, { display_name, bio } = {}) {
  getProfile(user);
  const now = Date.now();
  const fields = [];
  const values = [];

  if (typeof display_name === 'string') {
    fields.push('display_name = ?');
    values.push(String(display_name).trim().slice(0, 60) || null);
  }
  if (typeof bio === 'string') {
    fields.push('bio = ?');
    values.push(String(bio).trim().slice(0, 300) || null);
  }

  if (!fields.length) return getProfile(user);

  values.push(now, user);
  conn.prepare(`UPDATE user_profile SET ${fields.join(', ')}, updated_at = ? WHERE user = ?`)
    .run(...values);

  return getProfile(user);
}

// ============================================================
// Phone
// ============================================================
const PHONE_RE = /^0[0-9]{8,9}$/;

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s\-()]/g, '');
}

function validatePhone(phone) {
  const p = normalizePhone(phone);
  if (!PHONE_RE.test(p)) return [false, 'เบอร์ไม่ถูกต้อง (เช่น 0812345678)'];
  return [true, p];
}

function setPhoneUnverified(user, phone) {
  const [ok, normalized] = validatePhone(phone);
  if (!ok) return [false, normalized];
  const p = normalized;

  // ตรวจว่าเบอร์นี้ถูกใช้โดย user อื่นที่ verify แล้วหรือไม่
  const dup = conn.prepare(`
    SELECT user FROM user_profile
     WHERE phone = ? AND phone_verified = 1 AND user != ?
  `).get(p, user);
  if (dup) return [false, 'เบอร์นี้ถูกใช้โดยบัญชีอื่นแล้ว'];

  getProfile(user);
  conn.prepare(`
    UPDATE user_profile SET phone = ?, phone_verified = 0, updated_at = ? WHERE user = ?
  `).run(p, Date.now(), user);

  return [true, p];
}

function markPhoneVerified(user) {
  conn.prepare(`
    UPDATE user_profile SET phone_verified = 1, updated_at = ? WHERE user = ?
  `).run(Date.now(), user);
}

function clearPhone(user) {
  conn.prepare(`
    UPDATE user_profile SET phone = NULL, phone_verified = 0, updated_at = ? WHERE user = ?
  `).run(Date.now(), user);
}

// ============================================================
// Phone verification (OTP)
// ============================================================
function createPhoneVerification(user, phone, ttlSec = 300) {
  const [ok, normalized] = validatePhone(phone);
  if (!ok) return { ok: false, error: normalized };

  // ยกเลิกของเก่า
  conn.prepare(`
    UPDATE phone_verifications SET used = 1
     WHERE user = ? AND purpose = 'verify_phone' AND used = 0
  `).run(user);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const expires = now + ttlSec * 1000;

  conn.prepare(`
    INSERT INTO phone_verifications (token, user, phone, code, purpose, expires_at, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(token, user, normalized, code, 'verify_phone', expires, now);

  return { ok: true, token, code, phone: normalized, expires_at: expires };
}

function consumePhoneVerification(token, code) {
  if (!token || !code) return { ok: false, error: 'INVALID' };

  const row = conn.prepare(`
    SELECT * FROM phone_verifications WHERE token = ? AND purpose = 'verify_phone'
  `).get(token);

  if (!row) return { ok: false, error: 'NOT_FOUND' };
  if (row.used) return { ok: false, error: 'USED' };
  if (row.expires_at < Date.now()) return { ok: false, error: 'EXPIRED' };
  if (String(row.code) !== String(code).trim()) return { ok: false, error: 'WRONG_CODE' };

  conn.prepare(`UPDATE phone_verifications SET used = 1 WHERE token = ?`).run(token);

  return { ok: true, user: row.user, phone: row.phone };
}

// ============================================================
// Activity log
// ============================================================
function logActivity(user, action, detail, ip, ua) {
  try {
    conn.prepare(`
      INSERT INTO activity_log (user, action, detail, ip, ua, ts)
      VALUES (?,?,?,?,?,?)
    `).run(
      user || null,
      String(action),
      String(detail || ''),
      ip || null,
      ua || null,
      Date.now()
    );
  } catch (e) {
    console.error('[activity] error:', e.message);
  }
}

function listActivity(user, limit = 50) {
  return conn.prepare(`
    SELECT * FROM activity_log WHERE user = ? ORDER BY ts DESC LIMIT ?
  `).all(user, limit);
}

// ============================================================
// Delete account
// ============================================================
function deleteAccount(user) {
  const run = conn.transaction(() => {
    try { conn.prepare(`DELETE FROM user_profile WHERE user = ?`).run(user); } catch (_) {}
    try { conn.prepare(`DELETE FROM phone_verifications WHERE user = ?`).run(user); } catch (_) {}
    try { conn.prepare(`DELETE FROM email_verifications WHERE username = ?`).run(user); } catch (_) {}
    try { conn.prepare(`DELETE FROM activity_log WHERE user = ?`).run(user); } catch (_) {}
    try { conn.prepare(`DELETE FROM sessions WHERE user = ?`).run(user); } catch (_) {}
  });
  run();
  return true;
}

// ============================================================
// Exports
// ============================================================
module.exports = {
  getProfile,
  updateProfile,
  normalizePhone,
  validatePhone,
  setPhoneUnverified,
  markPhoneVerified,
  clearPhone,
  createPhoneVerification,
  consumePhoneVerification,
  logActivity,
  listActivity,
  deleteAccount,
};