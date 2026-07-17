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
    });
    if (!res.ok) {
      const text = await res.text();
      return json(502, { error: `Local model error (${res.status}). Is Ollama running?`, detail: text.slice(0, 200) });
    }

    // Stream Ollama's newline-delimited JSON tokens back to the browser as SSE.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
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
              if (!line) continue;
              try {
                const obj = JSON.parse(line);
                if (obj.response) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: obj.response })}\n\n`));
                }
              } catch {}
            }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        } catch (e) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "stream failed" })}\n\n`));
        } finally {
          controller.close();
          await slot.release();
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
    await slot.release();
    return json(502, { error: "Couldn't reach the local model. The operator's PC may be offline." });
  }
};
