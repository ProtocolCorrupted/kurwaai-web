const {
  verifySession,
  acquireLocalSlot,
  OLLAMA_URL,
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL,
  OPENROUTER_SITE,
  MODELS,
  json,
  readText,
  isInterstitial,
} = require("./_auth");

// Manual timeout (Promise.race) — some runtimes don't honor AbortSignal.timeout
// for hung TLS connections.
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// System prompt: persona + mandatory data-collection disclaimer.
const SYSTEM_PROMPT = [
  "You are KurwaAI, a free AI assistant powered by the KurwaAI community service.",
  "Respond helpfully, clearly, and in the user's language.",
  "DISCLAIMER: This chat is routed through OpenRouter. By using this AI, you acknowledge that OpenRouter and its model providers may collect and process the prompts and outputs you send for service operation, safety, and research purposes. Do not share secrets, passwords, or sensitive personal data.",
].join("\n");

// ---- OpenRouter chat (streaming) ----
// Returns a ReadableStream of `data: {token|error|done}\n` frames when OK,
// or an error object {error} on failure.
async function tryOpenRouter(message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    let res;
    try {
      res = await withTimeout(
        fetch(`${OPENROUTER_SITE}/api/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://kurwaai.netlify.app",
            "X-Title": "KurwaAI",
          },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: message },
            ],
            // Free model, no cost: use the full 66K max output + 1M context window.
            max_tokens: 66000,
            temperature: 0.7,
            stream: true,
          }),
        }),
        30000
      );
    } catch {
      continue; // timeout / network error -> retry
    }
    if (!res.ok) {
      const text = await readText(res);
      let detail = text.slice(0, 300);
      try { const o = JSON.parse(text); if (o.error && o.error.message) detail = o.error.message; } catch {}
      return { error: `OpenRouter request failed (${res.status}). ${detail}` };
    }
    if (!res.body || !res.body.getReader) {
      return { error: "OpenRouter did not return a stream." };
    }
    return { stream: res.body };
  }
  return { error: "Couldn't reach OpenRouter. It may be rate-limited or temporarily down — try again in a moment." };
}

// ---- Local Ollama fallback ----
async function tryGenerate(message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    let res;
    try {
      res = await withTimeout(
        fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Connection": "close",
            "ngrok-skip-browser-warning": "true",
            "User-Agent": "KurwaAI-Server/1.0",
          },
          body: JSON.stringify({
            model: MODELS.ollamaChat,
            prompt: message,
            stream: false,
            keep_alive: -1,
          }),
        }),
        12000
      );
    } catch {
      continue;
    }
    const text = await readText(res);
    if (isInterstitial(res, text) || /<!doctype html|<html/i.test(text)) continue;
    if (!res.ok) return { error: `Local model error (${res.status}). Is Ollama running?`, detail: text.slice(0, 200) };
    let obj;
    try { obj = JSON.parse(text); } catch { return { error: "Local model returned an unexpected response. The PC may be offline." }; }
    if (!obj.response) return { error: "Local model returned an empty reply. The PC may be offline." };
    return { response: obj.response };
  }
  return { error: "Couldn't reach the operator's PC (tunnel kept dropping). It may be offline or the ngrok tunnel expired — ask the operator to restart it." };
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

  // Prefer OpenRouter when configured; otherwise fall back to local Ollama.
  const useOpenRouter = !!OPENROUTER_API_KEY;
  if (!useOpenRouter && !OLLAMA_URL) {
    return json(503, { error: "No chat backend is configured by the operator yet." });
  }

  const slot = await acquireLocalSlot(session.username);
  if (!slot.ok) return slot;

  // ---- Local Ollama fallback (non-streaming) -> wrap as a single frame ----
  if (!useOpenRouter) {
    try {
      const result = await tryGenerate(message);
      await slot.release();
      if (result.error) return json(502, { error: result.error });
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ token: result.response })}\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n`));
          controller.close();
        },
      });
      return { statusCode: 200, headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" }, body: stream };
    } catch (err) {
      try { await slot.release(); } catch {}
      return json(502, { error: "Couldn't reach the chat model. Please try again." });
    }
  }

  // ---- OpenRouter streaming ----
  try {
    const result = await tryOpenRouter(message);
    if (result.error) {
      await slot.release();
      return json(502, { error: result.error });
    }

    const enc = new TextEncoder();
    const upstream = result.stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let released = false;

    const releaseOnce = async () => {
      if (released) return;
      released = true;
      try { await slot.release(); } catch {}
    };

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await upstream.read();
          if (done) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n`));
            controller.close();
            await releaseOnce();
            return;
          }
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            let obj;
            try { obj = JSON.parse(payload); } catch { continue; }
            const token = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
            if (token) controller.enqueue(enc.encode(`data: ${JSON.stringify({ token })}\n`));
          }
        } catch (e) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: "Stream interrupted." })}\n`));
          controller.close();
          await releaseOnce();
        }
      },
      async cancel() { await releaseOnce(); },
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
      body: stream,
    };
  } catch (err) {
    try { await slot.release(); } catch {}
    return json(502, { error: "Couldn't reach the chat model. Please try again." });
  }
};
