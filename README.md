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
                  ├─► Anthropic API (Plus/Max Claude models)
                  └─► Stripe (checkout + webhook → tier)
```

- `public/index.html` — the whole frontend (landing, login/register, console). No framework, no build step.
- `netlify/functions/_auth.js` — shared auth + tier config + rate-limit / queue / quota helpers.
- `netlify/functions/register.js`, `login.js`, `logout.js`, `me.js` — auth + account/tier info, backed by Netlify Blobs. Passwords hashed with bcrypt, session is a JWT in an `httpOnly` cookie.
- `netlify/functions/chat.js` — proxies chat to your Ollama (`qwen2.5-coder:7b`).
- `netlify/functions/generate.js` — runs your bundled Flux2-Klein ComfyUI workflow, returns the image.
- `netlify/functions/claude.js` — tier-gated Claude access with per-window quotas.
- `netlify/functions/stripe-checkout.js`, `stripe-webhook.js` — subscription flow.

## 1. Deploy

```bash
npm install
netlify init        # or connect this repo in the Netlify dashboard
netlify deploy --prod
```

## 2. Environment variables

In Netlify dashboard → Site settings → Environment variables:

```
JWT_SECRET            = <long random string>   # REQUIRED in production (fails closed otherwise)
OLLAMA_URL            = https://xxxx.ngrok-free.app   # your Ollama tunnel
COMFY_URL             = https://yyyy.ngrok-free.app   # your ComfyUI tunnel
ANTHROPIC_API_KEY     = sk-ant-...                    # for Plus/Max Claude
STRIPE_SECRET_KEY     = sk_live_...
STRIPE_WEBHOOK_SECRET = whsec_...
STRIPE_PRICE_PLUS     = price_...   # Stripe price ID for the Plus subscription
STRIPE_PRICE_MAX      = price_...   # Stripe price ID for the Max subscription
```

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

## 4. Stripe setup

1. Create two **subscription** products in the Stripe dashboard (Plus, Max).
2. Copy their **Price IDs** into `STRIPE_PRICE_PLUS` / `STRIPE_PRICE_MAX`.
3. Add a webhook endpoint: `https://<your-site>/.netlify/functions/stripe-webhook`
   (listen to `checkout.session.completed` and `customer.subscription.deleted`).
   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

On a successful checkout, the webhook flips the user's `tier` to `plus`/`max`. On
subscription cancellation, it reverts to `free`.

## 5. Tiers & limits

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
