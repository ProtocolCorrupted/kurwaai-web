const { verifySession, acquireLocalSlot, OLLAMA_URL, MODELS, json, readText, isInterstitial } = require("./_auth");

// ngrok free tunnels intermittently return an HTML "Inactivity Timeout" /
// verification page (ERR_NGROK_320) when the edge->agent link briefly drops.
// Retry once after a short pause — the agent usually reconnects within ~1s.
async function tryGenerate(message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200));
    let res;
    try {
      res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Connection": "close" },
        body: JSON.stringify({
          model: MODELS.ollamaChat,
          prompt: message,
          stream: false,
          keep_alive: -1,
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      continue; // network error -> retry
    }
    const text = await readText(res);
    if (isInterstitial(res, text) || /<!doctype html|<html/i.test(text)) {
      continue; // tunnel page -> retry
    }
    if (!res.ok) {
      return { error: `Local model error (${res.status}). Is Ollama running?`, detail: text.slice(0, 200) };
    }
    let obj;
    try { obj = JSON.parse(text); } catch { return { error: "Local model returned an unexpected response. The PC may be offline." }; }
    if (!obj.response) return { error: "Local model returned an empty reply. The PC may be offline." };
    return { response: obj.response };
  }
  return { error: "Couldn't reach the operator's PC (tunnel kept dropping). It may be offline or the ngrok tunnel expired." };
}

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
    const result = await tryGenerate(message);
    if (result.error) {
      await slot.release();
      return json(502, { error: result.error });
    }
    await slot.release();
    return json(200, { response: result.response });
  } catch (err) {
    try { await slot.release(); } catch {}
    return json(502, { error: "Couldn't reach the local model. The operator's PC may be offline." });
  }
};
