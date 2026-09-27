// language: JavaScript, file: mail-tools.js
'use strict';

const net = require('net');

// ============================================================
// DNS resolver (custom เพื่อไม่ให้ cache ของ system รบกวน)
// ============================================================
let resolver = null;

function getResolver() {
  if (resolver) return resolver;
  const Resolver = require('dns').Resolver;
  resolver = new Resolver({ timeout: parseInt(process.env.DNS_TIMEOUT || '5000', 10) });
  const servers = String(process.env.DNS_RESOLVER || '1.1.1.1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) resolver.setServers(servers);
  return resolver;
}

// ★ เพิ่ม timeout guard — กัน DNS ค้าง
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function resolveTxt(host) {
  return withTimeout(
    new Promise((resolve) => {
      getResolver().resolveTxt(host, (err, records) => {
        if (err) return resolve({ ok: false, error: err.code || err.message, records: [] });
        const flat = (records || []).map((chunks) => chunks.join(''));
        resolve({ ok: true, records: flat });
      });
    }),
    8000,
    { ok: false, error: 'DNS_TIMEOUT', records: [] }
  );
}

function resolveMx(host) {
  return withTimeout(
    new Promise((resolve) => {
      getResolver().resolveMx(host, (err, records) => {
        if (err) return resolve({ ok: false, error: err.code || err.message, records: [] });
        resolve({
          ok: true,
          records: (records || [])
            .sort((a, b) => a.priority - b.priority)
            .map((r) => ({ priority: r.priority, exchange: r.exchange })),
        });
      });
    }),
    8000,
    { ok: false, error: 'DNS_TIMEOUT', records: [] }
  );
}

function resolveA(host) {
  return withTimeout(
    new Promise((resolve) => {
      getResolver().resolve4(host, (err, addrs) => {
        if (err) return resolve({ ok: false, error: err.code || err.message, records: [] });
        resolve({ ok: true, records: addrs || [] });
      });
    }),
    8000,
    { ok: false, error: 'DNS_TIMEOUT', records: [] }
  );
}

function resolvePtr(ip) {
  return withTimeout(
    new Promise((resolve) => {
      getResolver().reverse(ip, (err, hosts) => {
        if (err) return resolve({ ok: false, error: err.code || err.message, records: [] });
        resolve({ ok: true, records: hosts || [] });
      });
    }),
    8000,
    { ok: false, error: 'DNS_TIMEOUT', records: [] }
  );
}

// ============================================================
// Domain validation
// ============================================================
function isValidDomain(d) {
  if (!d || typeof d !== 'string') return false;
  d = d.trim().toLowerCase();
  if (d.length < 3 || d.length > 253) return false;
  if (d.endsWith('.')) d = d.slice(0, -1);
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d)) {
    return false;
  }
  return true;
}

function normalizeDomain(d) {
  return String(d || '').trim().toLowerCase().replace(/\.$/, '');
}

// ============================================================
// SPF
// ============================================================
async function checkSPF(domain) {
  const domainNorm = normalizeDomain(domain);
  const res = await resolveTxt(domainNorm);

  if (!res.ok) {
    return {
      ok: false,
      found: false,
      error: res.error,
      records: [],
      raw: null,
      parsed: null,
      verdict: 'error',
      notes: [`ไม่สามารถดึง TXT: ${res.error}`],
    };
  }

  const spfRecords = res.records.filter((r) => /^v=spf1(\s|$)/i.test(r));

  if (!spfRecords.length) {
    return {
      ok: true,
      found: false,
      records: res.records,
      raw: null,
      parsed: null,
      verdict: 'fail',
      notes: ['ไม่พบ SPF record (v=spf1)'],
    };
  }

  if (spfRecords.length > 1) {
    return {
      ok: true,
      found: true,
      records: res.records,
      raw: spfRecords,
      parsed: null,
      verdict: 'fail',
      notes: [`พบ SPF มากกว่า 1 record (${spfRecords.length}) — RFC 7208 อนุญาตให้มีได้เพียง 1`],
    };
  }

  const raw = spfRecords[0];
  const parts = raw.split(/\s+/).slice(1);
  const parsed = {
    mechanisms: [],
    includes: [],
    ip4: [],
    ip6: [],
    a: 0,
    mx: 0,
    ptr: 0,
    all: null,
    redirect: null,
    exp: null,
    lookupCount: 0,
  };

  let allCount = 0;

  for (const p of parts) {
    const lc = p.toLowerCase();
    parsed.mechanisms.push(p);

    // ★ แก้ — ตรวจ redirect= ต้องเป็น prefix ที่แน่นอน
    if (lc.startsWith('include:')) {
      parsed.includes.push(p.slice(8));
      parsed.lookupCount++;
    } else if (lc.startsWith('ip4:')) {
      parsed.ip4.push(p.slice(4));
    } else if (lc.startsWith('ip6:')) {
      parsed.ip6.push(p.slice(4));
    } else if (lc === 'a' || lc.startsWith('a:') || lc.startsWith('a/')) {
      parsed.a++;
    } else if (lc === 'mx' || lc.startsWith('mx:')) {
      parsed.mx++;
      parsed.lookupCount++;
    } else if (lc === 'ptr' || lc.startsWith('ptr:')) {
      parsed.ptr++;
      parsed.lookupCount++;
    } else if (lc.startsWith('redirect=')) {
      // ★ แก้จาก `lc === 'redirect=' || lc.startsWith('redirect=')` — ซ้ำซ้อน
      parsed.redirect = p.slice(9);
      parsed.lookupCount++;
    } else if (lc.startsWith('exp=')) {
      parsed.exp = p.slice(4);
    }

    if (/^(?:[-~+?])?all$/i.test(p)) {
      allCount++;
      parsed.all = p;
    }
  }

  const notes = [];
  let verdict = 'pass';

  if (!parsed.all) {
    notes.push('ไม่มี "all" mechanism — ควรระบุ -all หรือ ~all');
    verdict = 'warn';
  } else if (/^-all$/i.test(parsed.all)) {
    notes.push('"all" เป็น -all (fail) — เข้มงวด เหมาะกับ production');
  } else if (/^~all$/i.test(parsed.all)) {
    notes.push('"all" เป็น ~all (softfail) — แนะนำให้เปลี่ยนเป็น -all');
    verdict = 'warn';
  } else if (/^\+all$/i.test(parsed.all)) {
    notes.push('"all" เป็น +all — ผิด, เปิดให้ทุกคนส่งเมลได้');
    verdict = 'fail';
  } else if (/^\?all$/i.test(parsed.all)) {
    notes.push('"all" เป็น ?all (neutral) — ไม่มีผลอะไร');
    verdict = 'warn';
  }

  if (allCount > 1) {
    notes.push('มี all mechanism ซ้ำ');
    verdict = 'fail';
  }

  if (parsed.lookupCount > 10) {
    notes.push(`DNS lookup count = ${parsed.lookupCount} เกิน 10 (RFC 7208)`);
    verdict = 'fail';
  }

  if (parsed.ptr > 0) {
    notes.push('มีการใช้ ptr — RFC 7208 ไม่แนะนำ (ช้า + ไม่น่าเชื่อถือ)');
    if (verdict === 'pass') verdict = 'warn';
  }

  if (raw.length > 450) {
    notes.push(`SPF ยาว ${raw.length} ตัวอักษร — ควรต่ำกว่า 450`);
    if (verdict === 'pass') verdict = 'warn';
  }

  // ★ เพิ่ม — ตรวจว่ามี provider ที่รู้จักไหม
  const knownProviders = [
    { re: /_spf\.google\.com/i, name: 'Google' },
    { re: /spf\.protection\.outlook\.com/i, name: 'Microsoft/Office 365' },
    { re: /sendgrid\.net/i, name: 'SendGrid' },
    { re: /mailgun\.org/i, name: 'Mailgun' },
    { re: /amazonses\.com/i, name: 'Amazon SES' },
    { re: /zoho\.com/i, name: 'Zoho' },
    { re: /cloudflare/i, name: 'Cloudflare' },
  ];
  const providers = [];
  for (const p of parsed.includes) {
    for (const k of knownProviders) {
      if (k.re.test(p)) { providers.push(k.name); break; }
    }
  }
  if (providers.length) {
    notes.push(`ตรวจพบ provider: ${[...new Set(providers)].join(', ')}`);
  }

  return {
    ok: true,
    found: true,
    records: res.records,
    raw,
    parsed,
    verdict,
    notes,
  };
}

// ============================================================
// DMARC
// ============================================================
async function checkDMARC(domain) {
  const domainNorm = normalizeDomain(domain);
  const host = `_dmarc.${domainNorm}`;
  const res = await resolveTxt(host);

  if (!res.ok) {
    return {
      ok: false,
      found: false,
      host,
      error: res.error,
      raw: null,
      parsed: null,
      verdict: 'fail',
      notes: [`ไม่พบ DMARC record ที่ ${host} (${res.error})`],
    };
  }

  const dmarcRecords = res.records.filter((r) => /^v=DMARC1\s*;/i.test(r));

  if (!dmarcRecords.length) {
    return {
      ok: true,
      found: false,
      host,
      raw: null,
      parsed: null,
      verdict: 'fail',
      notes: [`ไม่พบ DMARC record ที่ ${host}`],
    };
  }

  if (dmarcRecords.length > 1) {
    return {
      ok: true,
      found: true,
      host,
      raw: dmarcRecords,
      parsed: null,
      verdict: 'fail',
      notes: ['พบ DMARC มากกว่า 1 record'],
    };
  }

  const raw = dmarcRecords[0];
  const tags = {};
  for (const part of raw.split(';')) {
    const [k, v] = part.split('=').map((s) => (s || '').trim());
    if (k) tags[k.toLowerCase()] = v || '';
  }

  const parsed = {
    v: tags.v,
    p: tags.p || null,
    sp: tags.sp || null,
    rua: tags.rua ? tags.rua.split(',').map((s) => s.trim()).filter(Boolean) : [],
    ruf: tags.ruf ? tags.ruf.split(',').map((s) => s.trim()).filter(Boolean) : [],
    adkim: tags.adkim || 'r',
    aspf: tags.aspf || 'r',
    fo: tags.fo || null,
    pct: tags.pct ? parseInt(tags.pct, 10) : 100,
    rf: tags.rf || null,
    ri: tags.ri ? parseInt(tags.ri, 10) : 86400,
  };

  const notes = [];
  let verdict = 'pass';

  if (!parsed.p) {
    notes.push('ขาด tag "p=" (required)');
    verdict = 'fail';
  } else if (!['none', 'quarantine', 'reject'].includes(parsed.p)) {
    notes.push(`ค่า p=${parsed.p} ไม่ถูกต้อง`);
    verdict = 'fail';
  } else if (parsed.p === 'none') {
    notes.push('p=none — แค่ monitoring ยังไม่บล็อก');
    verdict = 'warn';
  } else if (parsed.p === 'quarantine') {
    notes.push('p=quarantine — ดี แต่อาจอัปเป็น reject');
  } else if (parsed.p === 'reject') {
    notes.push('p=reject — เข้มงวดที่สุด ✓');
  }

  if (parsed.pct !== undefined && parsed.pct !== 100) {
    notes.push(`pct=${parsed.pct} — นโยบายใช้กับบางส่วนเท่านั้น`);
    if (verdict === 'pass') verdict = 'warn';
  }

  if (!parsed.rua.length) {
    notes.push('ไม่มี rua= — ไม่มีรายงาน aggregate ส่งมา');
    if (verdict === 'pass') verdict = 'warn';
  }

  if (!parsed.ruf.length) {
    notes.push('ไม่มี ruf= — ไม่มีรายงาน forensic');
  }

  if (parsed.adkim === 's') {
    notes.push('adkim=s (strict) — DKIM ต้อง domain ตรงเป๊ะ');
  }
  if (parsed.aspf === 's') {
    notes.push('aspf=s (strict) — SPF ต้อง domain ตรงเป๊ะ');
  }

  return {
    ok: true,
    found: true,
    host,
    raw,
    tags,
    parsed,
    verdict,
    notes,
  };
}

// ============================================================
// DKIM
// ============================================================
const DEFAULT_SELECTORS = ['default', 'mail', 'google', 'selector1', 'selector2', 'k1', 's1', 'dkim', 'smtp', 'mg', 'sendgrid', 'mailgun', 'amazonses', 'zoho'];

function getSelectors() {
  const env = String(process.env.DKIM_SELECTORS || '').trim();
  if (!env) return DEFAULT_SELECTORS;
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function checkDKIM(domain, selectorOverride = null) {
  const domainNorm = normalizeDomain(domain);
  const selectors = selectorOverride
    ? [selectorOverride.trim()]
    : getSelectors();

  const results = [];
  let foundAny = false;

  // ★ ทำ parallel — เร็วกว่า loop ทีละตัว
  const tasks = selectors.map(async (sel) => {
    const host = `${sel}._domainkey.${domainNorm}`;
    const r = await resolveTxt(host);
    return { sel, host, r };
  });

  const resolved = await Promise.all(tasks);

  for (const { sel, host, r } of resolved) {
    if (r.ok && r.records.length) {
      for (const rec of r.records) {
        const parsed = parseDKIM(rec);
        results.push({ selector: sel, host, raw: rec, parsed, ok: true });
        foundAny = true;
      }
    } else {
      results.push({ selector: sel, host, ok: false, error: r.error || 'NOTFOUND' });
    }
  }

  const hits = results.filter((r) => r.ok);
  const notes = [];
  let verdict = 'pass';

  if (!foundAny) {
    verdict = 'fail';
    notes.push(`ไม่พบ DKIM record ใน selector ที่ลอง: ${selectors.join(', ')}`);
    notes.push('ถ้าใช้ provider เฉพาะ ให้ระบุ selector ใน env DKIM_SELECTORS');
  } else {
    for (const h of hits) {
      const p = h.parsed || {};
      if (p.v && p.v !== 'DKIM1') {
        notes.push(`${h.host} — v=${p.v} ไม่ใช่ DKIM1`);
        verdict = 'warn';
      }
      if (p.k && !['rsa', 'ed25519'].includes(p.k)) {
        notes.push(`${h.host} — k=${p.k} ไม่รู้จัก`);
        verdict = 'warn';
      }
      if (!p.p) {
        notes.push(`${h.host} — ขาด p= (public key)`);
        verdict = 'fail';
      }
    }
  }

  return {
    ok: true,
    found: foundAny,
    hits,
    results,
    verdict,
    notes,
    selectorsTried: selectors,
  };
}

function parseDKIM(txt) {
  const out = { raw: txt };
  for (const part of String(txt).split(';')) {
    const [k, ...rest] = part.split('=');
    const key = (k || '').trim().toLowerCase();
    const val = rest.join('=').trim();
    if (!key) continue;
    if (k.trim() !== key) out[key + '_ci'] = val;
    out[key] = val;
  }
  return out;
}

// ============================================================
// WAF Detection
// ============================================================
const WAF_SIGNATURES = [
  { name: 'Cloudflare',    header: 'cf-ray',        server: /cloudflare/i },
  { name: 'Cloudflare',    header: 'cf-cache-status' },
  { name: 'Akamai',        header: 'x-akamai-transformed' },
  { name: 'Akamai',        server: /akamaighost|akamai/i },
  { name: 'AWS CloudFront',header: 'x-amz-cf-id' },
  { name: 'AWS WAF',       header: 'x-amzn-waf-action' },
  { name: 'AWS WAF',       header: 'x-amzn-requestid' },
  { name: 'Fastly',        header: 'x-fastly-request-id' },
  { name: 'Fastly',        header: 'x-served-by' },
  { name: 'Fastly',        header: 'x-cache' },
  { name: 'Sucuri',        header: 'x-sucuri-id' },
  { name: 'Sucuri',        server: /sucuri/i },
  { name: 'Imperva',       header: 'x-iinfo' },
  { name: 'Imperva',       header: 'x-cdn' },
  { name: 'F5 BIG-IP',     header: 'x-wa-info' },
  { name: 'F5 BIG-IP',     server: /big-?ip|bigip/i },
  { name: 'Barracuda',     header: 'x-barracuda-' },
  { name: 'ModSecurity',   server: /mod_security|modsecurity/i },
  { name: 'ModSecurity',   header: 'x-mod-security' },
  { name: 'Wordfence',     header: 'x-wordfence' },
  { name: 'DDoS-Guard',    server: /ddos-guard/i },
  { name: 'DDoS-Guard',    header: 'x-ddos-guard' },
  { name: 'Google Cloud',  server: /gws|google/i },
  { name: 'StackPath',     header: 'x-sp-' },
  { name: 'Azure Front Door', header: 'x-azure-ref' },
  { name: 'Azure App Gateway', server: /microsoft-azure-application-gateway/i },
  { name: 'Wallarm',       header: 'x-wallarm-' },
  { name: 'Radvision',     server: /rdwr/i },
  { name: 'Citrix NetScaler', header: 'x-ns-' },
  { name: 'Citrix NetScaler', server: /ns-cache|netscaler/i },
  { name: 'Aliyun WAF',    server: /aliyun/i },
  { name: 'Tencent WAF',   header: 'x-nws-' },
  { name: '360 WAF',       header: 'x-waf-' },
  { name: 'Safe3',         server: /safe3/i },
  { name: 'Comodo',        server: /comodo/i },
  { name: 'Varnish',       header: 'x-varnish' },
  { name: 'Varnish',       server: /varnish/i },
  { name: 'Nginx',         server: /nginx/i },
  { name: 'Apache',        server: /apache/i },
  { name: 'LiteSpeed',     server: /litespeed/i },
  { name: 'IIS',           server: /microsoft-iis/i },
  { name: 'OpenResty',     server: /openresty/i },
  { name: 'Caddy',         server: /caddy/i },
];

const WAF_COOKIES = [
  { name: 'Cloudflare', pattern: /^__cf|^cf_clearance|^__cf_bm/i },
  { name: 'Incapsula',  pattern: /^incap_ses|^visid_incap/i },
  { name: 'Sucuri',     pattern: /^sucuri_cloudproxy/i },
  { name: 'Barracuda',  pattern: /^barra_counter_session/i },
  { name: 'F5 BIG-IP',  pattern: /^TS[a-f0-9]{6,}/i },
  { name: 'AWS WAF',    pattern: /^aws-waf-token/i },
  { name: 'Imperva',    pattern: /^nlbi_|^visid_incap/i },
  { name: 'Akamai',     pattern: /^ak_bmsc|^bm_sv/i },
  { name: 'DDoS-Guard', pattern: /^__ddg/i },
];

function detectWAF(headers = {}, setCookieRaw = '') {
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) {
    lower[String(k).toLowerCase()] = String(v);
  }
  const server = lower['server'] || '';
  const poweredBy = lower['x-powered-by'] || '';

  const hits = new Map();

  for (const sig of WAF_SIGNATURES) {
    let matched = false;
    if (sig.header && lower[sig.header]) matched = true;
    if (!matched && sig.server) {
      if (sig.server.test(server) || sig.server.test(poweredBy)) matched = true;
    }
    if (matched) {
      const cur = hits.get(sig.name) || { name: sig.name, reasons: [] };
      if (sig.header) cur.reasons.push(`header:${sig.header}`);
      if (sig.server) cur.reasons.push(`server:${server || poweredBy}`);
      hits.set(sig.name, cur);
    }
  }

  const cookies = String(setCookieRaw || '');
  if (cookies) {
    for (const c of WAF_COOKIES) {
      const m = cookies.match(/(?:^|,\s*)([^=;,\s]+)=/g) || [];
      for (const namePart of m) {
        const cname = namePart.replace(/[=,\s]/g, '');
        if (c.pattern.test(cname)) {
          const cur = hits.get(c.name) || { name: c.name, reasons: [] };
          cur.reasons.push(`cookie:${cname}`);
          hits.set(c.name, cur);
        }
      }
    }
  }

  return {
    detected: Array.from(hits.values()),
    count: hits.size,
    server,
    poweredBy,
  };
}

// ============================================================
// HTTP fetch สำหรับ WAF check
// ============================================================
async function fetchHeadersForWAF(host, { timeoutMs = 8000, followRedirect = true } = {}) {
  const http = require('http');
  const https = require('https');

  // ★ แก้ — ตรวจ http:// ให้ชัดเจน
  const trimmed = String(host).trim().replace(/\/+$/, '');
  const isExplicitHttp = /^http:\/\//i.test(trimmed);
  const url = isExplicitHttp
    ? trimmed
    : `https://${trimmed.replace(/^https?:\/\//i, '')}`;
  const mod = isExplicitHttp ? http : https;
  const maxRedirects = followRedirect ? 3 : 0;

  return new Promise((resolve) => {
    let redirects = 0;

    function doRequest(currentUrl) {
      let u;
      try { u = new URL(currentUrl); } catch (_) {
        return resolve({ ok: false, error: 'invalid url' });
      }

      const req = mod.request(
        {
          method: 'GET',
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          timeout: timeoutMs,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; KeeedumWAFCheck/1.0)',
            Accept: '*/*',
          },
          rejectUnauthorized: false,
        },
        (res) => {
          if (
            maxRedirects > 0 &&
            [301, 302, 303, 307, 308].includes(res.statusCode) &&
            res.headers.location &&
            redirects < maxRedirects
          ) {
            redirects++;
            res.resume();
            let next;
            try {
              next = new URL(res.headers.location, currentUrl).toString();
            } catch (_) {
              return resolve({ ok: false, error: 'invalid redirect' });
            }
            return doRequest(next);
          }

          const headers = res.headers;
          const setCookie = headers['set-cookie'] || [];

          res.resume();

          resolve({
            ok: true,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers,
            setCookie: Array.isArray(setCookie) ? setCookie.join(', ') : String(setCookie),
            finalUrl: currentUrl,
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'timeout' });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.end();
    }

    doRequest(url);
  });
}

// ============================================================
// รวมทุกอย่าง
// ============================================================
async function fullMailReport(domain) {
  const [spf, dmarc, dkim, mx] = await Promise.all([
    checkSPF(domain),
    checkDMARC(domain),
    checkDKIM(domain),
    resolveMx(domain),
  ]);

  // ★ เพิ่ม overall verdict
  const verdicts = [spf.verdict, dmarc.verdict, dkim.verdict];
  let overall = 'pass';
  if (verdicts.includes('fail')) overall = 'fail';
  else if (verdicts.includes('warn')) overall = 'warn';

  return { domain, spf, dmarc, dkim, mx, overall };
}

async function fullWAFReport(host) {
  const res = await fetchHeadersForWAF(host);
  if (!res.ok) {
    return { ok: false, host, error: res.error };
  }
  const detected = detectWAF(res.headers, res.setCookie);
  return {
    ok: true,
    host,
    finalUrl: res.finalUrl,
    statusCode: res.statusCode,
    headers: res.headers,
    detected,
  };
}

module.exports = {
  isValidDomain,
  normalizeDomain,
  resolveTxt,
  resolveMx,
  resolveA,
  resolvePtr,
  checkSPF,
  checkDMARC,
  checkDKIM,
  parseDKIM,
  detectWAF,
  fetchHeadersForWAF,
  fullMailReport,
  fullWAFReport,
};