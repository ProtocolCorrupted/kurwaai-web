const { verifySession, acquireLocalSlot, OLLAMA_URL, MODELS, json } = require("./_auth");

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
  if (!slot.ok) return slot; // error response

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.ollamaChat,
        prompt: message,
        stream: true,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      const text = await res.text();
      await slot.release();
      return json(502, { error: `Local model error (${res.status}). Is Ollama running?`, detail: text.slice(0, 200) });
    }

    // Stream Ollama's newline-delimited JSON tokens back to the browser as SSE.
    // Send periodic keepalive comments so idle proxies (and ngrok) don't drop
    // the connection while the model is loading the first token.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let keepalive;
        let released = false;
        const release = async () => {
          if (released) return;
          released = true;
          try { await slot.release(); } catch {}
        };
        const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          send({ info: "Thinking…" });
          keepalive = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); } catch {}
          }, 15000);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line || line.startsWith(":")) continue;
              try {
                const obj = JSON.parse(line);
                if (obj.response) send({ token: obj.response });
              } catch {}
            }
          }
          send({ done: true });
        } catch (e) {
          send({ error: "The local model connection dropped. The operator's PC may be offline." });
        } finally {
          clearInterval(keepalive);
          controller.close();
          await release();
        }
      },
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
      body: stream,
    };
  } catch (err) {
    try { await slot.release(); } catch {}
    return json(502, { error: "Couldn't reach the local model. The operator's PC may be offline." });
  }
};
