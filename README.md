# KurwaAI

A **free public AI service**: anyone registers and uses the operator's local hardware —
**Qwen chat** (Ollama) and **Flux image generation** (ComfyUI) — with server-enforced
usage limits. Paid tiers (Stripe subscriptions) add **Claude** model access
(Haiku 4.5 for Plus; Fable 5 / Opus 4.8 / Sonnet 5 / Haiku 4.5 for Max).

Model traffic is proxied through Netlify Functions so limits are enforced centrally and
the operator's tunnel URLs stay hidden.

## Architecture

```
Browser ──► Netlify Functions ──► operator's ngrok tunnel ──► Ollama :11434 / ComfyUI :8188
                  │
                  └─► Anthropic API (Plus/Max Claude models)
```

- `public/index.html` — the whole frontend (landing, login/register, console). No framework, no build step.
- `netlify/functions/_auth.js` — shared auth + tier config + rate-limit / queue / quota helpers.
- `netlify/functions/register.js`, `login.js`, `logout.js`, `me.js` — auth + account/tier info, backed by Netlify Blobs. Passwords hashed with bcrypt, session is a JWT in an `httpOnly` cookie.
- `netlify/functions/chat.js` — proxies chat to your Ollama (`gemma3:4b`).
- `netlify/functions/generate.js` — runs your bundled Flux2-Klein ComfyUI workflow, returns the image (disabled until `ENABLE_IMAGE_GEN=true`).
- `netlify/functions/claude.js` — tier-gated Claude access with per-window quotas.
- `netlify/functions/admin-set-tier.js` — admin-only endpoint to grant tiers after Discord payment.

## Upgrades (no Stripe — Discord-based)
Payments are handled manually. The operator's reserved account (`kurwaai` by default) gets
admin + Max automatically on first registration. After someone pays via Discord, the operator
opens the **Admin panel** in the app, types the user's username, picks a tier, and grants it.
There is no automated billing.

## 1. Deploy

```bash
npm install
netlify deploy --prod
```

## 2. Environment variables

In Netlify dashboard → Site settings → Environment variables:

```
JWT_SECRET            = <long random string>   # REQUIRED in production (fails closed otherwise)
OLLAMA_URL            = https://xxxx.ngrok-free.app   # your Ollama tunnel (REQUIRED for chat)
COMFY_URL             = https://yyyy.ngrok-free.app   # your ComfyUI tunnel (for image gen)
ANTHROPIC_API_KEY     = sk-ant-...                    # for Plus/Max Claude
DISCORD_INVITE        = https://disboard.org/server/1504909141095874662  # shown to users for upgrades
ADMIN_USERNAME        = kurwaai                       # reserved operator account name
ENABLE_IMAGE_GEN      = false                         # set true when you have a stronger GPU
NETLIFY_BLOBS_CONTEXT = base64({"siteID":"<site>","token":"<netlify-token>"})  # Blobs auth (already set)
```
```

### Upgrades (no Stripe — Discord-based)
Payments are handled manually. The operator's reserved account (`kurwaai` by default) gets
admin + Max automatically on first registration. After someone pays via Discord, the operator
opens the **Admin panel** in the app, types the user's username, picks a tier, and grants it.
There is no automated billing.

To enable image generation later, set `ENABLE_IMAGE_GEN=true`.
Claude is gated by user tier and enabled by default.

## 3. Expose your local models

On your PC (the operator machine), run a tunnel for each service:

```bash
ngrok http 11434   # Ollama
ngrok http 8188    # ComfyUI
```

Copy the `https://xxxx.ngrok-free.app` URLs into `OLLAMA_URL` / `COMFY_URL`.
ngrok free URLs change every restart — update the env vars when they do (or use
`cloudflared tunnel` with a fixed hostname to avoid this).

CORS: run Ollama with `OLLAMA_ORIGINS=*` and ComfyUI with `--enable-cors-header` so the
functions (server-side) and, if needed, the browser can reach them.

## 4. Tiers & limits

| | Free | Plus | Max |
|---|---|---|---|
| Qwen chat + Flux image | ✅ | ✅ | ✅ |
| Local limits | 5000 msg/day, 30 RPM, 2-slot queue | same | 100k/day, 600 RPM, 8-slot queue |
| Claude models | — | Haiku 4.5 | Fable 5, Opus 4.8, Sonnet 5, Haiku 4.5 |
| Claude quota | — | 500 msg/day, 5M tokens / 5h | 10k msg/day, 100M tokens / 5h |

Limits live in the `TIERS` config in `netlify/functions/_auth.js` — change them there.

## Notes

- The ComfyUI workflow is bundled at `netlify/functions/image_flux2_klein_text_to_image.json`
  (Flux2-Klein text-to-image). The user prompt is injected into node `76`; the seed
  (node `75:73`) is randomized per request. Swap in your own exported API-format workflow if needed.
- Queue is GeForce-Now style: when all GPU slots are busy, the request holds ~30s waiting
  for a free slot, then reports busy.
