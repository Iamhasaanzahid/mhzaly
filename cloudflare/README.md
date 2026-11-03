# MHZALY AI proxy — Cloudflare Worker

Free cloud backend for the AR page. **No PC needed**, no card, 100,000 requests/day free.

## Kya karta hai
- Keys **server par** rehti hain (browser me kabhi nahi aati)
- 7 providers ki free keys ko rotate karta hai (Gemini, Groq, OpenRouter, Cerebras, Mistral, Together, HuggingFace)
- Sab keys khatam → keyless free AI par fallback
- `/api/image` par 4 free FLUX/SD3.5 spaces rotate karta hai (1024×1536)

## Deploy (5 minute, sirf browser)
1. https://dash.cloudflare.com → free account banao
2. **Workers & Pages** → **Create** → **Worker** → naam `mhzaly-ai` → **Deploy**
3. **Edit code** → `worker.js` ka poora content paste karo → **Deploy**
4. **Settings → Variables and Secrets** → add karo (jitni keys ho, comma se alag):
   - `GEMINI_KEYS`
   - `GROQ_KEYS`
   - `OPENROUTER_KEYS`
   - `CEREBRAS_KEYS`
   - `MISTRAL_KEYS`
   - `TOGETHER_KEYS`
   - `HUGGINGFACE_KEYS`
5. Worker URL copy karo: `https://mhzaly-ai.<account>.workers.dev`
6. Site par: **AI settings → Backend URL** me paste karke **Save** karo

## Test
```bash
curl https://mhzaly-ai.<account>.workers.dev/health
curl -X POST https://mhzaly-ai.<account>.workers.dev/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a light blue cotton kurta"}'
```

## Free keys kahan se
| Provider | Free tier | Link |
|---|---|---|
| Gemini | 1500 req/day | https://aistudio.google.com/apikey |
| Groq | generous free | https://console.groq.com/keys |
| OpenRouter | free models | https://openrouter.ai/keys |
| Cerebras | free tier | https://cloud.cerebras.ai |
| Mistral | free tier | https://console.mistral.ai |
| Together | $1 free credit | https://api.together.ai |
| HuggingFace | free inference | https://huggingface.co/settings/tokens |

> Keys leaked repos se mat lo — wo chori hui hoti hain aur jaldi ban ho jati hain.
