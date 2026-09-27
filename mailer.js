// language: JavaScript, file: mailer.js
'use strict';

const nodemailer = require('nodemailer');

let transporter = null;
let verifyResult = null;

// ============================================================
// Config
// ============================================================
function getConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@localhost',
    replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_USER,
    appName: process.env.APP_TITLE || 'Keeedum AI',
  };
}

// ============================================================
// Transporter
// ============================================================
function getTransporter() {
  if (transporter) return transporter;

  const cfg = getConfig();

  if (!cfg.host || !cfg.user || !cfg.pass) {
    console.warn('[MAILER] ⚠️  SMTP ไม่ได้ตั้งค่า — จะ log อีเมลแทน');
    return null;
  }

  const cleanPass = String(cfg.pass).replace(/\s+/g, '');

  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cleanPass },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    // ★ disable keep-alive ที่ Gmail SMTP relay ไม่ชอบ
    // (แต่ยังใช้ pool ได้)
    tls: {
      // ★ บังคับ TLS 1.2+
      minVersion: 'TLSv1.2',
      // ★ ปิด SNI ปลอม
      servername: cfg.host,
    },
    logger: process.env.DEBUG_MAIL === '1',
    debug: process.env.DEBUG_MAIL === '1',
  });

  console.log(`[MAILER] ✅ transporter created  host=${cfg.host}:${cfg.port} secure=${cfg.secure} user=${cfg.user}`);
  return transporter;
}

function FROM() { return getConfig().from; }
function REPLY_TO() { return getConfig().replyTo; }
function PUBLIC_URL() {
  return (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

// ============================================================
// Send helpers
// ============================================================
async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  const baseUrl = PUBLIC_URL();
  const cfg = getConfig();

  // ★ ต้องมี text เสมอ — Gmail spam filter ชอบ email ที่มี plain text
  //   ถ้าไม่มี text → สร้างจาก html
  let plainText = text;
  if (!plainText && html) {
    plainText = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  if (!t) {
    console.log('\n╔══════════════════════════════════════════════');
    console.log('║ 📧 EMAIL (SMTP disabled — log only)');
    console.log('╠══════════════════════════════════════════════');
    console.log(`║ To:      ${to}`);
    console.log(`║ From:    ${cfg.from}`);
    console.log(`║ Subject: ${subject}`);
    console.log('╠══════════════════════════════════════════════');
    console.log(plainText || '(empty)');
    console.log('╚══════════════════════════════════════════════\n');
    return { ok: true, simulated: true, to, subject };
  }

  try {
    const info = await t.sendMail({
      from: cfg.from,
      to,
      replyTo: cfg.replyTo,
      subject,
      text: plainText,
      html: html || undefined,
      // ★ headers ที่ช่วยลด spam score
      headers: {
        // Gmail ชอบ — มีลิงก์ยกเลิกสมัคร
        'List-Unsubscribe': `<${baseUrl}/account>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        // ระบุ client
        'X-Mailer': cfg.appName,
        // priority ปกติ (ห้ามใช้ high — spam trigger)
        'X-Priority': '3',
        'Importance': 'Normal',
        // ป้องกัน auto-reply loops
        'Auto-Submitted': 'auto-generated',
        'Precedence': 'bulk',
      },
      // ★ envelope = from เพื่อ Gmail ตรวจ SPF ได้ตรง
      envelope: {
        from: extractEmail(cfg.from),
        to,
      },
    });

    console.log(`[MAILER] ✅ sent  to=${to}  id=${info.messageId}`);
    console.log(`[MAILER]    response: ${info.response}`);
    return { ok: true, messageId: info.messageId, response: info.response, to };
  } catch (e) {
    console.error(`[MAILER] ❌ error to=${to}: ${e.message}`);
    if (e.responseCode) console.error(`[MAILER]    responseCode=${e.responseCode}`);
    if (e.command) console.error(`[MAILER]    command=${e.command}`);
    if (e.response) console.error(`[MAILER]    response=${e.response}`);

    if (plainText && plainText.includes('/verify?token=')) {
      const m = plainText.match(/https?:\/\/[^\s]+\/verify\?token=[^\s]+/);
      if (m) console.log(`[MAILER] 🔗 Fallback link: ${m[0]}`);
    }

    return { ok: false, error: e.message, responseCode: e.responseCode, response: e.response };
  }
}

// ★ ดึงอีเมลออกจาก "Name <email@x.com>"
function extractEmail(s) {
  if (!s) return '';
  const m = String(s).match(/<([^>]+)>/);
  return m ? m[1].trim() : String(s).trim();
}

// ============================================================
// Templates
// ============================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function verifyEmailTemplate(username, token, ttlSec) {
  const url = `${PUBLIC_URL()}/verify?token=${encodeURIComponent(token)}`;
  const hours = Math.max(1, Math.floor(ttlSec / 3600));
  const cfg = getConfig();

  // ★ text — เรียบง่าย ไม่มี emoji, ไม่มีลิงก์ซ้ำ
  const text = `สวัสดี ${username},

ขอบคุณที่สมัครสมาชิก ${cfg.appName}

กรุณายืนยันอีเมลของคุณโดยคลิกที่ลิงก์ด้านล่างนี้:
${url}

ลิงก์นี้จะหมดอายุภายใน ${hours} ชั่วโมง

หากคุณไม่ได้สมัครบัญชีนี้ กรุณาเพิกเฉยต่ออีเมลนี้ได้เลย

ขอแสดงความนับถือ
ทีมงาน ${cfg.appName}
${PUBLIC_URL()}
`;

  // ★ html — เรียบง่าย ขาว ไม่มี table ซ้อน ไม่มี emoji
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,'Noto Sans Thai',sans-serif;font-size:14px;line-height:1.6;color:#333333;">
<div style="max-width:600px;margin:0 auto;padding:24px;">

  <p style="margin:0 0 16px;">สวัสดี <strong>${escapeHtml(username)}</strong>,</p>

  <p style="margin:0 0 16px;">ขอบคุณที่สมัครสมาชิก ${escapeHtml(cfg.appName)} กรุณายืนยันอีเมลของคุณโดยคลิกที่ปุ่มด้านล่างนี้:</p>

  <p style="margin:24px 0;text-align:center;">
    <a href="${escapeHtml(url)}"
       style="display:inline-block;padding:12px 28px;background:#f59e0b;color:#000000;text-decoration:none;font-weight:bold;border-radius:0;">
      ยืนยันอีเมล
    </a>
  </p>

  <p style="margin:16px 0;">หรือคัดลอกลิงก์ต่อไปนี้ไปวางในเบราว์เซอร์:</p>
  <p style="margin:0 0 16px;word-break:break-all;font-family:monospace;font-size:12px;color:#555555;">
    ${escapeHtml(url)}
  </p>

  <p style="margin:0 0 16px;">ลิงก์นี้จะหมดอายุภายใน ${hours} ชั่วโมง</p>

  <hr style="border:0;border-top:1px solid #dddddd;margin:24px 0;">

  <p style="margin:0;color:#888888;font-size:12px;">
    หากคุณไม่ได้สมัครบัญชีนี้ กรุณาเพิกเฉยต่ออีเมลนี้ได้เลย<br>
    ${escapeHtml(cfg.appName)} · <a href="${escapeHtml(PUBLIC_URL())}" style="color:#888888;">${escapeHtml(PUBLIC_URL())}</a>
  </p>

</div>
</body>
</html>`;

  return { text, html, url };
}

// ============================================================
// Public API
// ============================================================
async function sendVerificationEmail(email, username, token) {
  const ttl = parseInt(process.env.VERIFY_TOKEN_TTL || '3600', 10);
  const { text, html } = verifyEmailTemplate(username, token, ttl);
  const cfg = getConfig();

  const fallbackUrl = `${PUBLIC_URL()}/verify?token=${encodeURIComponent(token)}`;
  console.log(`[MAILER] 📤 preparing verify email  to=${email}`);
  console.log(`[MAILER]    link: ${fallbackUrl}`);

  // ★ subject — ไม่มี emoji, ไม่มีคำ spammy, ตรงไปตรงมา
  return sendMail({
    to: email,
    subject: `ยืนยันอีเมลสำหรับบัญชี ${cfg.appName}`,
    text,
    html,
  });
}

async function sendWelcomeEmail(email, username) {
  const url = PUBLIC_URL();
  const cfg = getConfig();
  return sendMail({
    to: email,
    subject: `ยินดีต้อนรับสู่ ${cfg.appName}`,
    text: `สวัสดี ${username},

อีเมลของคุณได้รับการยืนยันเรียบร้อยแล้ว
คุณสามารถเริ่มใช้งานได้ที่: ${url}

ขอแสดงความนับถือ
ทีมงาน ${cfg.appName}`,
    html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,'Noto Sans Thai',sans-serif;font-size:14px;line-height:1.6;color:#333333;">
  <h2 style="margin:0 0 16px;font-size:18px;">ยินดีต้อนรับ ${escapeHtml(username)}</h2>
  <p>อีเมลของคุณได้รับการยืนยันเรียบร้อยแล้ว</p>
  <p>คุณสามารถเริ่มใช้งานได้ที่:</p>
  <p><a href="${escapeHtml(url)}" style="color:#f59e0b;">${escapeHtml(url)}</a></p>
  <hr style="border:0;border-top:1px solid #dddddd;margin:24px 0;">
  <p style="color:#888;font-size:12px;">ทีมงาน ${escapeHtml(cfg.appName)}</p>
</body></html>`,
  });
}

async function sendPasswordResetEmail(email, username, token) {
  const url = `${PUBLIC_URL()}/reset?token=${encodeURIComponent(token)}`;
  const cfg = getConfig();
  return sendMail({
    to: email,
    subject: `รีเซ็ตรหัสผ่านบัญชี ${cfg.appName}`,
    text: `สวัสดี ${username},

มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ
คลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่:
${url}

ลิงก์นี้จะหมดอายุภายใน 1 ชั่วโมง

หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลนี้

ทีมงาน ${cfg.appName}`,
    html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,'Noto Sans Thai',sans-serif;font-size:14px;line-height:1.6;color:#333333;">
  <h2 style="margin:0 0 16px;font-size:18px;">รีเซ็ตรหัสผ่าน</h2>
  <p>สวัสดี ${escapeHtml(username)}</p>
  <p>มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ คลิกที่ปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่:</p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#000;text-decoration:none;font-weight:bold;">ตั้งรหัสผ่านใหม่</a></p>
  <p style="word-break:break-all;font-size:12px;color:#555;">${escapeHtml(url)}</p>
  <p>ลิงก์นี้จะหมดอายุภายใน 1 ชั่วโมง</p>
  <hr style="border:0;border-top:1px solid #dddddd;margin:24px 0;">
  <p style="color:#888;font-size:12px;">หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลนี้<br>ทีมงาน ${escapeHtml(cfg.appName)}</p>
</body></html>`,
  });
}

// ============================================================
// Verify SMTP
// ============================================================
async function verifySmtp() {
  const t = getTransporter();
  if (!t) {
    return { ok: false, error: 'SMTP ไม่ได้ตั้งค่าใน .env' };
  }

  try {
    await t.verify();
    verifyResult = { ok: true, ts: Date.now() };
    return verifyResult;
  } catch (e) {
    const detail = {
      ok: false,
      error: e.message,
      code: e.code,
      command: e.command,
      responseCode: e.responseCode,
      response: e.response,
    };
    verifyResult = detail;

    console.error(`[MAILER] ❌ verify ล้มเหลว: ${e.message}`);
    if (e.responseCode === 535) {
      console.error('[MAILER]    → App Password ผิด');
      console.error('[MAILER]    → https://myaccount.google.com/apppasswords');
    } else if (e.code === 'ENOTFOUND') {
      console.error('[MAILER]    → SMTP_HOST ผิด ต้องเป็น smtp.gmail.com');
    } else if (e.code === 'ETIMEDOUT' || e.code === 'ECONNECTION') {
      console.error('[MAILER]    → ลอง port 465 + SMTP_SECURE=true');
    }
    return detail;
  }
}

function getVerifyResult() { return verifyResult; }

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  verifySmtp,
  getVerifyResult,
};