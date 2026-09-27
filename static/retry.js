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
  let errorMsg = "";                                    // ★ เพิ่ม

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

    if (!res.ok) throw new Error("HTTP " + res.status);       // ★ จะได้ errorMsg = "HTTP 429"

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      if (S.stop) {
        try { reader.cancel(); } catch (_) {}
        break;
      }

      const { done, value } = await reader.read();
      if (S.stop) { try { reader.cancel(); } catch (_) {} break; }
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
    errorMsg = e.message || String(e);                     // ★ เก็บ error
    if (body) {
      body.textContent = "❌ " + errorMsg;
      body.style.color = "var(--bad)";
    }
    full = "";
  } finally {
    const live = $id("thinkLive");
    if (live) live.style.display = "none";

    if (full && !errorMsg) {                               // ★ เก็บประวัติเฉพาะสำเร็จ
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

  return { full, think, wrap, body, cp, error: errorMsg };  // ★ ส่ง error กลับ
}