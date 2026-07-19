const fs = require("fs");
const path = require("path");
const { verifySession, acquireLocalSlot, COMFY_URL, FEATURES, json, readText, isInterstitial } = require("./_auth");

function loadWorkflow() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "image_flux2_klein_text_to_image.json"), "utf8")
  );
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

  const prompt = (body.prompt || "").toString().slice(0, 2000);
  if (!prompt.trim()) return json(400, { error: "Empty prompt." });

  if (!FEATURES.imageGen) return json(503, { error: "Image generation is temporarily disabled by the operator. Chat is available." });
  if (!COMFY_URL) return json(503, { error: "ComfyUI endpoint is not configured by the operator yet." });

  const slot = await acquireLocalSlot(session.username);
  if (!slot.ok) return slot; // error response (queue full / rate limited)

  try {
    // Build a fresh workflow with the user's prompt + randomized seed.
    const wf = JSON.parse(JSON.stringify(loadWorkflow()));
    wf["76"].inputs.value = prompt;
    wf["75:73"].inputs.noise_seed = Math.floor(Math.random() * 1e15);
    if (body.width && Number.isFinite(+body.width)) wf["75:68"].inputs.value = Math.min(2048, Math.max(64, +body.width));
    if (body.height && Number.isFinite(+body.height)) wf["75:69"].inputs.value = Math.min(2048, Math.max(64, +body.height));

    // Queue the prompt.
    const NGROK_HEADERS = { "ngrok-skip-browser-warning": "true", "User-Agent": "KurwaAI-Server/1.0" };
    const qRes = await fetch(`${COMFY_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...NGROK_HEADERS },
      body: JSON.stringify({ prompt: wf, client_id: `kurwaai-${session.username}` }),
    });
    if (!qRes.ok) {
      const text = await readText(qRes);
      if (isInterstitial(qRes, text)) {
        return json(502, { error: "The operator's tunnel is showing a verification page. Ask the operator to click through it or upgrade ngrok." });
      }
      return json(502, { error: `ComfyUI rejected the prompt (${qRes.status}).`, detail: text.slice(0, 200) });
    }
    const { prompt_id } = await qRes.json();
    if (!prompt_id) return json(502, { error: "ComfyUI did not return a prompt id." });

    // Poll history until the output is ready.
    let output = null;
    const deadline = Date.now() + 180000; // 3 min max
    while (Date.now() < deadline) {
      const hRes = await fetch(`${COMFY_URL}/history/${prompt_id}`, { headers: NGROK_HEADERS });
      if (hRes.ok) {
        const hist = await hRes.json();
        const entry = hist[prompt_id];
        if (entry && entry.outputs && entry.outputs["9"] && entry.outputs["9"].images && entry.outputs["9"].images.length) {
          output = entry.outputs["9"].images[0];
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!output) return json(504, { error: "Image generation timed out. The operator's GPU may be busy." });

    // Fetch the actual image bytes.
    const viewUrl = `${COMFY_URL}/view?filename=${encodeURIComponent(output.filename)}&subfolder=${encodeURIComponent(output.subfolder || "")}&type=${encodeURIComponent(output.type || "output")}`;
    const imgRes = await fetch(viewUrl, { headers: NGROK_HEADERS });
    if (!imgRes.ok) return json(502, { error: "Failed to fetch generated image." });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const b64 = buf.toString("base64");
    const mime = imgRes.headers.get("content-type") || "image/png";

    return json(200, { image: `data:${mime};base64,${b64}` });
  } catch (err) {
    return json(502, { error: "Couldn't reach ComfyUI. The operator's PC may be offline." });
  } finally {
    await slot.release();
  }
};
