// language: JavaScript, file: lib/httpClient.js, target: Node 18+
// http helper — ดึง proxy จาก proxyLoader ทุกครั้ง, timeout 15s
const { pick } = require('./proxyLoader');

let ProxyAgent = null;
try { ({ ProxyAgent } = require('undici')); } catch (_) {}

function pickDispatcher() {
  if (!ProxyAgent) return undefined;
  const p = pick();
  if (!p) return undefined;
  try { return new ProxyAgent(p); } catch (_) { return undefined; }
}

async function fetchJson(url, { method = 'GET', headers = {}, body, json, redirect = 'follow', timeout = 15000 } = {}) {
  const opts = { method, headers: { ...headers }, redirect };
  if (json !== undefined) {
    opts.headers['content-type'] = opts.headers['content-type'] || 'application/json;charset=UTF-8';
    opts.body = JSON.stringify(json);
  } else if (body !== undefined) {
    opts.body = typeof body === 'string' ? body : new URLSearchParams(body).toString();
  }
  const d = pickDispatcher();
  if (d) opts.dispatcher = d;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  opts.signal = ctrl.signal;
  try {
    return await fetch(url, opts);
  } finally {
    clearTimeout(t);
  }
}

module.exports = { fetchJson, pickDispatcher };