// One-off test: submit the bundled Flux2-Klein workflow to local ComfyUI.
const fs = require("fs");
const path = require("path");
const COMFY = "http://localhost:8188";

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, "netlify", "functions", "image_flux2_klein_text_to_image.json"), "utf8"));
wf["76"].inputs.value = "a neon cat riding a bicycle, synthwave";
wf["75:73"].inputs.noise_seed = Math.floor(Math.random() * 1e15);

(async () => {
  const q = await fetch(`${COMFY}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: wf }),
  });
  console.log("queue status:", q.status);
  const qj = await q.json();
  console.log("queue resp:", JSON.stringify(qj).slice(0, 400));
  if (!qj.prompt_id) { console.log("NO PROMPT ID — workflow rejected"); return; }
  const id = qj.prompt_id;
  for (let i = 0; i < 40; i++) {
    const h = await fetch(`${COMFY}/history/${id}`);
    if (h.ok) {
      const hist = await h.json();
      const e = hist[id];
      if (e && e.outputs && e.outputs["9"] && e.outputs["9"].images && e.outputs["9"].images.length) {
        const img = e.outputs["9"].images[0];
        console.log("DONE. image:", JSON.stringify(img));
        const v = await fetch(`${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder||"")}&type=${encodeURIComponent(img.type||"output")}`);
        console.log("view status:", v.status, "content-type:", v.headers.get("content-type"));
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log("timed out waiting");
})();
