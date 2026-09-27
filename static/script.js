// ============================================================
// static/script.js — Keeedum AI (Frontend Logic)
// ============================================================
'use strict';

// ============================================================
// CSRF + AUTH WRAPPER
// ============================================================
function getCsrf() {
  // ★ อ่านจาก window.CSRF_TOKEN ก่อน (index.ejs ส่งมา)
  if (typeof window !== 'undefined' && window.CSRF_TOKEN) {
    return window.CSRF_TOKEN;
  }
  // fallback: meta tag
  const m = document.querySelector('meta[name="csrf-token"]');
  return m ? m.content : "";
}

async function api(url, opts = {}) {
  opts.headers = opts.headers || {};
  const method = (opts.method || "GET").toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    opts.headers["X-CSRF-Token"] = getCsrf();
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    console.warn("[AUTH] 401 → redirect /login");
    window.location.href = "/login";
    throw new Error("ต้อง login");
  }
  return res;
}

function postJSON(url, data = {}) {
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, _csrf: getCsrf() }),
  });
}

function logout() {
  if (confirm("ออกจากระบบ?")) window.location.href = "/logout";
}

// ============================================================
// STATE
// ============================================================
const S = {
  model: "",
  persona: "ปกติ",
  prompts: {},
  temp: 0.7,
  folder: "",
  hist: [],
  gen: false,
  stop: false,
  host: "",
};

// ============================================================
// HELPERS
// ============================================================
function $id(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[DOM] ไม่พบ element #${id}`);
  return el;
}

function setText(id, text) {
  const el = $id(id);
  if (el) el.textContent = text;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================
// INIT
// ============================================================
async function init() {
  console.log("[INIT] เริ่มต้นแอป");

  try {
    const r = await fetch("/api/me");
    if (r.status === 401) {
      console.warn("[AUTH] ยังไม่ได้ login");
      window.location.href = "/login";
      return;
    }
    const me = await r.json();
    console.log("[AUTH]", me);
  } catch (e) {
    console.warn("[INIT] /api/me error", e);
  }

  await loadPrompts();
  await loadConfig();
  await loadModels();
  await loadFolder();
  bindUI();

  // ★ ไม่เรียก checkDailyReward() ที่นี่
  //   index.ejs จัดการ popup เองผ่าน window.SHOW_DAILY_POPUP

  const modelLine = S.model
    ? `🧠 โมเดล: ${S.model}`
    : `🧠 โมเดล: (ยังไม่ได้เลือก)`;

  addMsg(
    "ai",
    `สวัสดีครับ 👋 ตอบไทยล้วน\n\n` +
      `${modelLine}\n` +
      `🎭 นิสัย: ${S.persona}\n\n` +
      `ลองสั่ง:\n` +
      `• สร้างโปรเจกต์ Flask ชื่อ hello\n` +
      `• แก้ไฟล์ app.py ให้เพิ่ม logging\n` +
      `• เขียนสคริปต์ backup\n\n` +
      `📁 ${S.folder}`
  );
}

// ============================================================
// DAILY REWARD POPUP (เรียกจาก index.ejs — ไม่ใช่ auto)
// ============================================================
async function checkDailyReward() {
  try {
    const r = await fetch("/api/daily/status");
    if (!r.ok) return;
    const d = await r.json();
    if (!d.ok) return;

    if (!d.claimed_today) {
      if (sessionStorage.getItem("dailyPopupClosed") === "1") return;
      setTimeout(() => {
        const popup = document.getElementById("dailyPopup");
        if (popup) popup.classList.add("show");
      }, 800);
    }
  } catch (e) {
    console.warn("[DAILY] check error:", e);
  }
}

function closeDailyPopup() {
  const p = document.getElementById("dailyPopup");
  if (p) p.classList.remove("show");
  try {
    sessionStorage.setItem("dailyPopupClosed", "1");
  } catch (_) {}
}

// ============================================================
// PROMPTS / PERSONA
// ============================================================
async function loadPrompts() {
  try {
    const r = await api("/api/prompts");
    S.prompts = await r.json();
    console.log("[PROMPTS] โหลด", Object.keys(S.prompts).length, "นิสัย");
    if (!S.prompts[S.persona]) S.persona = Object.keys(S.prompts)[0] || "ปกติ";
    renderKeybar();
  } catch (e) {
    console.error("[PROMPTS] error:", e);
    S.prompts = { ปกติ: "" };
    S.persona = "ปกติ";
    renderKeybar();
  }
}

function renderKeybar() {
  const kb = $id("keybar");
  if (!kb) return;
  kb.innerHTML = "";
  for (const name of Object.keys(S.prompts)) {
    const b = document.createElement("button");
    b.className = "keycap" + (name === S.persona ? " active" : "");
    b.textContent = name;
    b.dataset.name = name;
    b.onclick = () => selectPersona(name);
    kb.appendChild(b);
  }
  setText("personaLabel", "กำลังใช้: " + S.persona);
}

function selectPersona(name) {
  S.persona = name;
  renderKeybar();
  postJSON("/api/config", { persona: name }).catch(() => {});
  setStatus("🎭 เปลี่ยนนิสัย: " + name, "var(--ok)");
  setTimeout(() => setStatus("🟢 พร้อมใช้งาน", "var(--ok)"), 1200);
}

async function reloadPrompts() {
  try {
    const r = await postJSON("/api/prompts/reload");
    S.prompts = await r.json();
    if (!S.prompts[S.persona]) S.persona = Object.keys(S.prompts)[0] || "ปกติ";
    renderKeybar();
    setStatus(`🔄 โหลด ${Object.keys(S.prompts).length} นิสัยแล้ว`, "var(--ok)");
  } catch (e) {
    setStatus("🔴 โหลดนิสัยล้มเหลว", "var(--bad)");
  }
}

// ============================================================
// MODELS
// ============================================================
async function loadModels(showToastMsg = false) {
  const sel = $id("modelSel");
  const info = $id("modelInfo");
  if (!sel || !info) return;

  sel.innerHTML = '<option>⏳ กำลังโหลด...</option>';
  sel.disabled = true;
  info.innerHTML = '<span class="model-loading">กำลังตรวจสอบ...</span>';

  try {
    const r = await api("/api/models");
    const d = await r.json();
    console.log("[MODELS] /api/models →", d);

    sel.innerHTML = "";
    info.innerHTML = "";

    if (!d.ok) {
      const errMsg = d.error || "ไม่ทราบสาเหตุ";
      sel.innerHTML = '<option disabled>❌ โหลดโมเดลไม่ได้</option>';
      S.model = "";
      info.innerHTML =
        `<span class="model-badge warn">⚠️ ${escapeHtml(errMsg)}</span>` +
        `<span class="model-badge">กด 🔄 ลองใหม่</span>`;
      setStatus("🔴 " + errMsg, "var(--bad)");
      sel.disabled = false;
      return;
    }

    if (!d.models || !d.models.length) {
      sel.innerHTML = '<option disabled>⚠️ ไม่มีโมเดล</option>';
      S.model = "";
      info.innerHTML =
        `<span class="model-badge warn">⚠️ ไม่พบโมเดล</span>`;
      setStatus("🟡 เชื่อมต่อได้ แต่ไม่มีโมเดล", "var(--accent)");
      sel.disabled = false;
      return;
    }

    d.models.forEach((m) => {
      const o = document.createElement("option");
      o.value = m.name;
      const meta = [m.param, m.quant].filter(Boolean).join(" · ");
      o.textContent = meta ? `${m.name}  (${meta})` : m.name;
      o.dataset.size = m.size || "";
      o.dataset.param = m.param || "";
      o.dataset.quant = m.quant || "";
      o.dataset.family = m.family || "";
      sel.appendChild(o);
    });

    let preferred = S.model;
    try {
      const cfg = await api("/api/config").then((r) => r.json());
      if (cfg.model) preferred = cfg.model;
    } catch (_) {}

    const exists = d.models.find((m) => m.name === preferred);
    S.model = exists ? preferred : d.models[0].name;
    sel.value = S.model;

    updateModelInfo();
    if (d.host) S.host = d.host;
    setStatus(`🟢 เชื่อมต่อ · ${d.models.length} โมเดล`, "var(--ok)");
    if (showToastMsg) showToast(`🔄 โหลด ${d.models.length} โมเดลแล้ว`);

    warmModel(S.model);
  } catch (e) {
    console.error("[MODELS] exception:", e);
    sel.innerHTML = '<option disabled>❌ เชื่อมต่อ server ไม่ได้</option>';
    S.model = "";
    info.innerHTML =
      `<span class="model-badge warn">⚠️ ${escapeHtml(e.message)}</span>`;
    setStatus("🔴 " + e.message, "var(--bad)");
  } finally {
    sel.disabled = false;
  }
}

function updateModelInfo() {
  const sel = $id("modelSel");
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return;
  setText("modelParam", opt.dataset.param || "");
  setText("modelQuant", opt.dataset.quant || "");
  setText("modelSize", opt.dataset.size || "");
  ["modelParam", "modelQuant", "modelSize"].forEach((id) => {
    const el = $id(id);
    if (el) el.classList.toggle("ok", !!el.textContent);
  });
}

async function selectModel(name) {
  S.model = name;
  updateModelInfo();
  setStatus(`🧠 เปลี่ยนโมเดล: ${name}`, "var(--accent)");
  console.log("[MODELS] select:", name);

  postJSON("/api/models/select", { model: name }).catch(() => {});
  warmModel(name);
  setTimeout(() => setStatus("🟢 พร้อมใช้งาน", "var(--ok)"), 1000);
}

async function warmModel(name) {
  if (!name) return;
  try {
    const r = await postJSON("/api/models/warm", { model: name });
    const d = await r.json();
    if (d.ok) {
      console.log("[MODELS] warm ok:", name);
      setStatus(`🔥 โหลด ${name} เข้า memory แล้ว`, "var(--ok)");
      setTimeout(() => setStatus("🟢 พร้อมใช้งาน", "var(--ok)"), 1500);
    }
  } catch (e) {
    console.warn("[MODELS] warm exception:", e);
  }
}

async function refreshModels() {
  const btn = $id("refreshModelsBtn");
  if (btn) btn.classList.add("spinning");
  try {
    await loadModels(true);
  } finally {
    setTimeout(() => {
      if (btn) btn.classList.remove("spinning");
    }, 600);
  }
}

// ============================================================
// CONFIG / FOLDER
// ============================================================
async function loadConfig() {
  try {
    const r = await api("/api/config");
    const d = await r.json();
    if (d.persona && S.prompts[d.persona]) {
      S.persona = d.persona;
      renderKeybar();
    }
    if (d.model) S.model = d.model;
    if (typeof d.temp === "number") {
      S.temp = d.temp;
      const sl = $id("tempSlider");
      if (sl) sl.value = S.temp;
    }
    console.log("[CONFIG]", d);
  } catch (e) {
    console.warn("[CONFIG] error:", e);
  }
}

async function loadFolder() {
  try {
    const r = await api("/api/folder");
    const d = await r.json();
    S.folder = d.folder;
    setText("folderLabel", S.folder);
    console.log("[FOLDER]", S.folder);
  } catch (e) {
    console.warn("[FOLDER] error:", e);
  }
}

// ============================================================
// UI BINDINGS
// ============================================================
function bindUI() {
  const inp = $id("input");
  if (inp) {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    inp.addEventListener("input", () => {
      inp.style.height = "auto";
      inp.style.height = Math.min(inp.scrollHeight, 200) + "px";
    });
  }

  const sel = $id("modelSel");
  if (sel) {
    sel.onchange = (e) => {
      if (e.target.value && !e.target.disabled) selectModel(e.target.value);
    };
  }

  const rb = $id("refreshModelsBtn");
  if (rb) rb.onclick = refreshModels;

  const sl = $id("tempSlider");
  if (sl) {
    sl.oninput = (e) => {
      S.temp = parseFloat(e.target.value);
      const lbl = S.temp < 0.4 ? "แม่นยำ" : S.temp < 1.0 ? "สมดุล" : "สร้างสรรค์";
      setText("tempLabel", S.temp.toFixed(1) + " · " + lbl);
    };
    sl.onchange = () => {
      postJSON("/api/config", { temp: S.temp }).catch(() => {});
    };
  }

  const kb = $id("keybar");
  if (kb) {
    kb.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          kb.scrollLeft += e.deltaY;
        }
      },
      { passive: false }
    );
  }

  // Retry switch
  const swRetry = $id("swRetry");
  if (swRetry) {
    setTimeout(() => {
      if (typeof RetryConfig !== "undefined") {
        swRetry.checked = RetryConfig.enabled;
      }
    }, 100);

    swRetry.onchange = (e) => {
      if (typeof RetryConfig !== "undefined") {
        RetryConfig.enabled = e.target.checked;
        console.log("[RETRY] ตั้งค่า:", RetryConfig.enabled);
        showToast(RetryConfig.enabled ? "🔄 เปิด auto-retry" : "⏸️ ปิด auto-retry");
      }
    };
  }

  // ESC ปิด modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-bg.show").forEach(b => b.classList.remove("show"));
    }
  });

  // Click backdrop ปิด modal
  document.querySelectorAll(".modal-bg").forEach((bg) => {
    bg.addEventListener("click", (e) => {
      if (e.target === bg) bg.classList.remove("show");
    });
  });
}

// ============================================================
// CHAT — MESSAGES
// ============================================================
function addMsg(role, content, thinking) {
  const chat = $id("chat");
  if (!chat) return { wrap: null, body: null, cp: null };

  const wrap = document.createElement("div");
  wrap.className = "msg " + role;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const head = document.createElement("div");
  head.className = "head-row";

  const name = document.createElement("span");
  name.textContent = role === "user" ? "🧑 คุณ" : "🤖 AI";

  const cp = document.createElement("button");
  cp.className = "copy-btn";
  cp.textContent = "📋";
  cp.title = "คัดลอกข้อความ";
  cp.type = "button";
  cp.dataset.copyText = content || "";

  const doCopy = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    copyText(cp.dataset.copyText || "");
  };
  cp.onclick = doCopy;
  cp.ontouchend = doCopy;

  head.appendChild(name);
  head.appendChild(cp);
  bubble.appendChild(head);

  const swThink = $id("swThink");
  if (thinking && swThink && swThink.checked) {
    const tb = document.createElement("div");
    tb.className = "think-box";
    tb.textContent = thinking.slice(0, 500);
    bubble.appendChild(tb);
  }

  const body = document.createElement("div");
  body.textContent = content;
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";
  bubble.appendChild(body);
  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
  return { wrap, body, cp };
}

// ============================================================
// COPY — 3 ชั้น fallback
// ============================================================
async function copyText(text) {
  if (!text) {
    showToast("⚠️ ไม่มีข้อความ");
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      showToast("📋 คัดลอกแล้ว");
      return;
    }
  } catch (e) {
    console.warn("[COPY] clipboard API failed:", e);
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "none";
    ta.style.outline = "none";
    ta.style.boxShadow = "none";
    ta.style.background = "transparent";
    ta.style.opacity = "0";
    ta.style.fontSize = "16px";
    document.body.appendChild(ta);

    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);

    if (ok) {
      showToast("📋 คัดลอกแล้ว");
      return;
    }
  } catch (e) {
    console.warn("[COPY] execCommand failed:", e);
  }

  manualCopyModal(text);
}

function manualCopyModal(text) {
  const old = document.getElementById("copyModal");
  if (old) old.remove();

  const bg = document.createElement("div");
  bg.id = "copyModal";
  bg.className = "modal-bg show";
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <h3>📋 คัดลอกข้อความ</h3>
    <p style="font-size:12px;color:var(--dim);margin-bottom:10px;">
      เลือกข้อความด้านล่างแล้วกดคัดลอก (Ctrl+C / ค้าง+คัดลอก)
    </p>
    <textarea id="copyTextarea" readonly
      style="width:100%;height:200px;padding:10px;background:var(--bg);
             color:var(--text);border:2px solid var(--border-hard);
             font-family:monospace;font-size:12px;resize:vertical;"></textarea>
    <div class="actions" style="margin-top:14px;">
      <button class="btn-ghost" onclick="document.getElementById('copyModal').remove()">
        ปิด
      </button>
      <button class="btn-primary" onclick="selectCopyText()">
        เลือกทั้งหมด
      </button>
    </div>
  `;

  bg.appendChild(box);
  document.body.appendChild(bg);

  const ta = document.getElementById("copyTextarea");
  ta.value = text;
  setTimeout(() => { ta.focus(); ta.select(); }, 100);
}

function selectCopyText() {
  const ta = document.getElementById("copyTextarea");
  if (!ta) return;
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  try {
    if (document.execCommand("copy")) {
      showToast("📋 คัดลอกแล้ว");
      const m = document.getElementById("copyModal");
      if (m) m.remove();
    } else {
      showToast("⚠️ กด Ctrl+C เพื่อคัดลอก");
    }
  } catch (e) {
    showToast("⚠️ กด Ctrl+C เพื่อคัดลอก");
  }
}

function clearChat() {
  const chat = $id("chat");
  if (chat) chat.innerHTML = "";
  S.hist = [];
  addMsg("ai", "ล้างแล้ว ✨");
}

function setStatus(text, color) {
  const el = $id("status");
  if (!el) return;
  el.textContent = text;
  el.style.color = color || "var(--dim)";
}

function showToast(msg) {
  const t = $id("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1500);
}

// ============================================================
// SEND — wrapper
// ============================================================
async function send() {
  if (S.gen) return;

  if (!S.model) {
    showToast("⚠️ ยังไม่ได้เลือกโมเดล");
    setStatus("🔴 ยังไม่มีโมเดล — กด 🔄 ที่หัวข้อโมเดล", "var(--bad)");
    return;
  }

  const inp = $id("input");
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;

  inp.value = "";
  inp.style.height = "auto";

  if (typeof sendWithRetry === "function") {
    await sendWithRetry(text);
  } else {
    await sendOnce(text);
  }
}

// ============================================================
// SEND ONCE
// ============================================================
async function sendOnce(text, opts = {}) {
  const { skipUserMsg = false } = opts;

  if (!skipUserMsg) {
    addMsg("user", text);
    S.hist.push({ role: "user", content: text });
  }

  S.gen = true;
  S.stop = false;

  const btn = $id("sendBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "...";
  }

  if (!skipUserMsg) {
    setStatus("🤔 กำลังคิด...", "var(--accent)");
  }

  const { wrap, body, cp } = addMsg("ai", "");
  let full = "";
  let think = "";

  try {
    const swEdit = $id("swEdit");
    const res = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: S.hist.slice(-6),
        persona: S.persona,
        model: S.model,
        temp: S.temp,
        editmode: swEdit ? swEdit.checked : true,
        folder: S.folder,
        _csrf: getCsrf(),
      }),
    });

    if (!res.ok) throw new Error("HTTP " + res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      if (S.stop) {
        try { reader.cancel(); } catch (_) {}
        break;
      }

      const { done, value } = await reader.read();

      if (S.stop) {
        try { reader.cancel(); } catch (_) {}
        break;
      }

      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();

      for (const p of parts) {
        const line = p.trim();
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        try {
          const ck = JSON.parse(raw);
          if (ck.error) throw new Error(ck.error);

          const swThink = $id("swThink");
          if (ck.thinking) {
            think += ck.thinking;
            if (swThink && swThink.checked) {
              const live = $id("thinkLive");
              if (live) {
                live.style.display = "block";
                live.textContent = "💭 " + think.slice(-800);
              }
            }
          }
          if (ck.content) {
            const live = $id("thinkLive");
            if (live) live.style.display = "none";
            full += ck.content;
            if (body) body.textContent = full;
            const chat = $id("chat");
            if (chat) chat.scrollTop = chat.scrollHeight;
          }
        } catch (e) {
          console.error("[CHAT] parse error:", e);
        }
      }
    }
  } catch (e) {
    console.error("[CHAT] error:", e);
    if (body) {
      body.textContent = "❌ " + e.message;
      body.style.color = "var(--bad)";
    }
    full = "";
  } finally {
    const live = $id("thinkLive");
    if (live) live.style.display = "none";

    if (full) {
      S.hist.push({ role: "assistant", content: full, thinking: think });
      if (cp) {
        cp.dataset.copyText = full;
      }
      await saveFiles(full);
    }

    S.gen = false;
    S.stop = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "ส่ง ➤";
    }
    setStatus("🟢 พร้อมใช้งาน", "var(--ok)");
  }

  return { full, think, wrap, body, cp };
}

// ============================================================
// STOP
// ============================================================
function stopGen() {
  console.log("[STOP] ผู้ใช้กดหยุด");
  S.stop = true;
  S.gen = false;
  setStatus("⏹ หยุดแล้ว", "var(--accent)");

  const btn = $id("sendBtn");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "ส่ง ➤";
  }

  setTimeout(() => {
    if (S.stop) setStatus("🟢 พร้อมใช้งาน", "var(--ok)");
  }, 2000);
}

async function saveFiles(text) {
  try {
    const swAutow = $id("swAutow");
    const r = await postJSON("/api/save_files", {
      text,
      folder: S.folder,
      autowrite: swAutow ? swAutow.checked : true,
    });
    const d = await r.json();

    if (d.skipped) {
      if (d.count) addMsg("ai", `📄 พบ ${d.count} ไฟล์ (${d.reason})`);
      return;
    }

    const lines = [];
    if (d.written?.length) {
      lines.push(`✅ ดำเนินการ ${d.written.length} ไฟล์:`);
      d.written.forEach((w) => lines.push(`   ${w.tag} ${w.path}`));
    }
    if (d.errors?.length) {
      lines.push("⚠️ ผิดพลาด:");
      d.errors.forEach((e) => lines.push(`   • ${e}`));
    }
    if (lines.length) {
      lines.push(`\n📁 ${d.folder}`);
      addMsg("ai", lines.join("\n"));
      setStatus(`✅ ${d.written?.length || 0} ไฟล์`, "var(--ok)");
    }
  } catch (e) {
    console.error("[FILES] error:", e);
  }
}

// ============================================================
// FOLDER PICKER
// ============================================================
async function openFolderPicker() {
  const m = $id("folderModal");
  if (m) m.classList.add("show");
  const pi = $id("pathInput");
  if (pi) pi.value = S.folder;
  await browseDir(S.folder);
}

function closeFolderPicker() {
  const m = $id("folderModal");
  if (m) m.classList.remove("show");
}

async function browseDir(path) {
  try {
    const r = await postJSON("/api/browse", { path });
    const d = await r.json();
    if (!d.ok) {
      showToast("⚠️ " + (d.error || "เข้าถึงไม่ได้"));
      return;
    }
    const pi = $id("pathInput");
    if (pi) pi.value = d.path;

    const list = $id("dirList");
    if (!list) return;
    list.innerHTML = "";

    if (d.parent) {
      const up = document.createElement("div");
      up.className = "dir-item";
      up.textContent = "⬆️ ..";
      up.onclick = () => browseDir(d.parent);
      list.appendChild(up);
    }

    if (!d.dirs || !d.dirs.length) {
      const empty = document.createElement("div");
      empty.className = "dir-empty";
      empty.textContent = "📂 ไม่มีโฟลเดอร์ย่อย";
      list.appendChild(empty);
    } else {
      for (const name of d.dirs) {
        const item = document.createElement("div");
        item.className = "dir-item";
        item.textContent = "📁 " + name;
        item.onclick = () => browseDir(d.path + "/" + name);
        list.appendChild(item);
      }
    }

    if (d.roots && d.roots.length && d.path === d.roots[0]) {
      const info = document.createElement("div");
      info.className = "dir-info";
      info.textContent = "ℹ️ โฟลเดอร์ที่อนุญาต: " + d.roots.join(", ");
      list.appendChild(info);
    }
  } catch (e) {
    console.error("[BROWSE] error:", e);
    showToast("⚠️ เปิดโฟลเดอร์ไม่ได้");
  }
}

function renderKeybar() {
  const kb = $id("keybar");
  if (!kb) return;

  kb.innerHTML = "";

  const names = Object.keys(S.prompts);
  if (!names.length) {
    const empty = document.createElement("span");
    empty.style.cssText =
      "padding:8px 14px;color:var(--dim);font-size:11px;" +
      "white-space:nowrap;display:inline-flex;align-items:center;";
    empty.textContent = "ไม่มีนิสัย — กด 🔄 โหลด";
    kb.appendChild(empty);
    setText("personaLabel", "กำลังใช้: (ไม่มี)");
    return;
  }

  for (const name of names) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "keycap" + (name === S.persona ? " active" : "");
    b.textContent = name;
    b.dataset.name = name;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", name === S.persona ? "true" : "false");
    b.onclick = (e) => {
      e.preventDefault();
      selectPersona(name);
    };
    kb.appendChild(b);
  }

  setText("personaLabel", "กำลังใช้: " + S.persona);
}

async function useFolder() {
  const pi = $id("pathInput");
  if (!pi) return;
  const path = pi.value.trim();
  if (!path) return;
  try {
    const r = await postJSON("/api/folder", { folder: path });
    const d = await r.json();
    if (d.error) {
      showToast("⚠️ " + d.error);
      return;
    }
    S.folder = d.folder;
    setText("folderLabel", S.folder);
    closeFolderPicker();
    showToast("📂 เปลี่ยนโฟลเดอร์แล้ว");
  } catch (e) {
    console.error("[FOLDER] set error:", e);
  }
}

async function openFolderOS() {
  try {
    await postJSON("/api/open_folder", { folder: S.folder });
  } catch (e) {
    console.error("[FOLDER] open error:", e);
  }
}

// ============================================================
// ★ EXPOSE GLOBALS (ให้ retry.js + onclick เข้าถึง)
// ============================================================
window.S = S;
window.state = S;           // alias
window.send = send;
window.sendOnce = sendOnce;
window.addMsg = addMsg;
window.setStatus = setStatus;
window.showToast = showToast;
window.clearChat = clearChat;
window.stopGen = stopGen;
window.copyText = copyText;
window.selectCopyText = selectCopyText;
window.reloadPrompts = reloadPrompts;
window.openFolderPicker = openFolderPicker;
window.closeFolderPicker = closeFolderPicker;
window.useFolder = useFolder;
window.openFolderOS = openFolderOS;
window.closeDailyPopup = closeDailyPopup;
window.checkDailyReward = checkDailyReward;
window.getCsrf = getCsrf;
window.postJSON = postJSON;
window.api = api;
window.$id = $id;

// ============================================================
// START
// ============================================================
init();