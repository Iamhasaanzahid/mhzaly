# MHZALY AI proxy — Cloudflare Worker

Free AI image backend for the MHZALY AR page. **No API keys required.**

Live URL: `https://mhzaly-ai.mhzaly.workers.dev`

## Why a Worker

- Runs in Cloudflare's network, so a visitor's ISP block or a slow upstream
  never matters (this fixed `Failed to fetch` on Pollinations and
  `ERR_CERT_DATE_INVALID` on the fresh `workers.dev` certificate).
- Free plan: 100,000 requests/day, Workers AI included.

## Image pipeline (`GET /api/image?prompt=...`)

1. **Cloudflare Workers AI — FLUX.1-schnell** (`@cf/black-forest-labs/flux-1-schnell`)
   Free, no key, runs inside Cloudflare. ~3–9 s, 1024×1024, sharp.
   This is the primary path and succeeds almost every time.
2. **Public Hugging Face Spaces** (FLUX.1-schnell / FLUX.1-merged / FLUX.1-dev /
   SD3.5) at 1024×1536 — used only if Workers AI fails.
   `flux-merged` and `flux-dev` use 20/25 steps; at 4 steps they are blurry.
3. **Pollinations `sana`** — last resort (free tier: 1 image per ~35 s).

Every layer returns a proper `image/*` body with CORS headers, otherwise
`502 {"error":"image unavailable"}` so the site can fall back to the
design-locked render.

## Vision (`POST /api/vision`)

Body: `{ "image": "<base64 jpeg>" }` → `{ ok, model, description }`.

Reads the uploaded garment and returns one dense sentence, e.g.
*"blue and yellow dress with a gold border and embroidery"*. The site sends a
768 px JPEG, then uses the sentence in the image prompt, so the generated model
wears the **same garment** (colour, print, embroidery, borders) instead of a
random one. Runs on `@cf/llava-hf/llava-1.5-7b-hf` (~3 s).

## Text planning (`POST /api/generate`)

Optional. Uses any provider keys set as secrets (`GEMINI_KEYS`, `GROQ_KEYS`,
`OPENROUTER_KEYS`, `CEREBRAS_KEYS`, `MISTRAL_KEYS`, `TOGETHER_KEYS`,
`HUGGINGFACE_KEYS` — comma-separated). Without keys the site plans locally.

## Deploy

```bash
cd cloudflare
npx wrangler login
npx wrangler deploy          # uses wrangler.jsonc (AI binding included)
```

`wrangler.jsonc` binds Workers AI as `env.AI`. Remove that binding and the
worker silently falls through to the Hugging Face / Pollinations paths.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | `{ok, keys, providers}` |
| `/api/generate` | POST | `{prompt}` → plan JSON |
| `/api/image` | GET | `?prompt=` → image bytes |

## Notes

- The site already points at this worker by default
  (`AR_API_BASE` in `site/mhzaly-ar.html`).
- To use a different backend, open the AR page → **AI settings** →
  **Cloud backend URL** and paste it; it is stored in `localStorage`.
