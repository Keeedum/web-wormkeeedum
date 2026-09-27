// language: JavaScript, file: lib/proxyLoader.js, target: Node 18+
// โหลด proxy จาก proxy.txt — rotate อัตโนมัติ, hot reload เมื่อไฟล์เปลี่ยน
const fs = require('fs');
const path = require('path');

const PROXY_FILE = path.join(__dirname, '..', 'proxy.txt');
const RELOAD_MS = 30_000; // เช็คไฟล์ทุก 30 วิ

let _list = [];
let _lastMtime = 0;
let _lastCheck = 0;

function parseProxy(line) {
  const s = String(line || '').trim();
  if (!s || s.startsWith('#')) return null;
  // รองรับ: host:port | user:pass@host:port | http://... | socks5://...
  if (/^(https?|socks[45]):\/\//i.test(s)) return s;
  if (/^[^@]+@[^:]+:\d+$/.test(s)) return `http://${s}`;
  if (/^[^:]+:\d+$/.test(s)) return `http://${s}`;
  return null;
}

function loadFromDisk() {
  try {
    const st = fs.statSync(PROXY_FILE);
    if (st.mtimeMs === _lastMtime) return;
    _lastMtime = st.mtimeMs;
  } catch (_) {
    _list = [];
    return;
  }
  try {
    const raw = fs.readFileSync(PROXY_FILE, 'utf8');
    const arr = raw.split(/\r?\n/).map(parseProxy).filter(Boolean);
    _list = arr;
    console.log(`[PROXY] โหลด ${_list.length} รายการจาก ${PROXY_FILE}`);
  } catch (e) {
    console.log(`[PROXY] อ่านไฟล์ไม่ได้: ${e.message}`);
    _list = [];
  }
}

function maybeReload() {
  const now = Date.now();
  if (now - _lastCheck < RELOAD_MS) return;
  _lastCheck = now;
  loadFromDisk();
}

// ★ เรียกครั้งแรก
loadFromDisk();

function list() {
  maybeReload();
  return _list.slice();
}

function count() {
  maybeReload();
  return _list.length;
}

function pick() {
  maybeReload();
  if (!_list.length) return null;
  return _list[Math.floor(Math.random() * _list.length)];
}

function rotateIterator() {
  maybeReload();
  let i = 0;
  return {
    next() { if (!_list.length) return null; const p = _list[i % _list.length]; i++; return p; },
    reset() { i = 0; },
    size() { return _list.length; },
  };
}

module.exports = { list, count, pick, rotateIterator, reload: loadFromDisk, PROXY_FILE };