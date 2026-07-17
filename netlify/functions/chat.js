const { verifySession, acquireLocalSlot, OLLAMA_URL, MODELS, json, readText, isInterstitial } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const session = verifySession(event);
  if (!session) return json(401, { error: "Not logged in." });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  const message = (body.message || "").toString().slice(0, 8000);
  if (!message.trim()) return json(400, { error: "Empty message." });

  if (!OLLAMA_URL) return json(503, { error: "Ollama endpoint is not configured by the operator yet." });

  const slot = await acquireLocalSlot(session.username);
  if (!slot.ok) return slot;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.ollamaChat,
        prompt: message,
        stream: false,
        keep_alive: -1,
      }),
      signal: AbortSignal.timeout(25000),
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await readText(res);
    if (isInterstitial(res, text)) {
      await slot.release();
      return json(502, { error: "The operator's tunnel is showing a verification page. Ask the operator to click through it or upgrade ngrok." });
    }
    if (!res.ok) {
      await slot.release();
      return json(502, { error: `Local model error (${res.status}). Is Ollama running?`, detail: text.slice(0, 200) });
    }

    let reply = "";
    try {
      const obj = JSON.parse(text);
      reply = obj.response || "";
    } catch {
      reply = text;
    }
    await slot.release();
    return json(200, { response: reply });
  } catch (err) {
    try { await slot.release(); } catch {}
    return json(502, { error: "Couldn't reach the local model. The operator's PC may be offline." });
  }
};
