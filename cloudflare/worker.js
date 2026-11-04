/**
 * MHZALY AI proxy — Cloudflare Worker (free plan: 100k requests/day).
 *
 * Why: keeps API keys on the server (never in the browser) and gives one
 * stable endpoint that rotates across many free-tier providers.
 *
 * Deploy:
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. Paste this file, Deploy
 *   3. Settings → Variables → add secrets (comma-separated, any subset):
 *        GEMINI_KEYS, GROQ_KEYS, OPENROUTER_KEYS, CEREBRAS_KEYS,
 *        MISTRAL_KEYS, TOGETHER_KEYS, HUGGINGFACE_KEYS
 *   4. Copy the worker URL (https://<name>.<account>.workers.dev)
 *      and paste it into the site: AI settings → Backend URL
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const SYSTEM = `You are an AR asset planner. Reply with JSON only:
{"assetType":"3d-model","category":"kurta|shirt|suit|dress|saree|shalwar kameez|curtains|sofa|bag|shoes|3d asset",
"placement":"body|window|floor|wall|table","style":"photoreal","description":"one vivid sentence describing the item, colour, fabric and pattern",
"targetUnits":"meters"}`;

const PROVIDERS = {
  gemini: { kind: "gemini", base: "https://generativelanguage.googleapis.com/v1beta/models", model: "gemini-flash-latest" },
  groq: { kind: "openai", base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  openrouter: { kind: "openai", base: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.1-8b-instruct:free" },
  cerebras: { kind: "openai", base: "https://api.cerebras.ai/v1", model: "llama3.1-8b" },
  mistral: { kind: "openai", base: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  together: { kind: "openai", base: "https://api.together.xyz/v1", model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" },
  huggingface: { kind: "openai", base: "https://api-inference.huggingface.co/v1", model: "meta-llama/Llama-3.1-8B-Instruct" },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function pool(env) {
  const out = [];
  for (const name of Object.keys(PROVIDERS)) {
    const raw = env[name.toUpperCase() + "_KEYS"] || "";
    for (const key of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      out.push({ provider: name, key });
    }
  }
  return out;
}

async function callOne(provider, key, prompt) {
  const cfg = PROVIDERS[provider];
  if (cfg.kind === "gemini") {
    const url = `${cfg.base}/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
      }),
    });
    if (!res.ok) throw new Error(provider + " " + res.status);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new Error(provider + " " + res.status);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

function parsePlan(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return { assetType: "3d-model", category: "3d asset", placement: "floor", style: "photoreal", description: String(text || "").slice(0, 240), targetUnits: "meters" };
}

async function freePlan(prompt) {
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai",
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error("free " + res.status);
  const data = await res.json();
  return parsePlan(data?.choices?.[0]?.message?.content || "");
}

async function planFor(prompt) {
  for (const { provider, key } of pool({ ...globalThis.__env })) {
    try {
      const plan = parsePlan(await callOne(provider, key, prompt));
      if (plan && plan.description) return plan;
    } catch {}
  }
  try { return await freePlan(prompt); } catch {}
  return parsePlan("");
}

const SPACES = [
  { id: "flux-schnell", base: "https://black-forest-labs-flux-1-schnell.hf.space", ep: "/infer", args: (p, s) => [p, s, true, 1024, 1536, 4] },
  { id: "flux-merged", base: "https://multimodalart-flux-1-merged.hf.space", ep: "/infer", args: (p, s) => [p, s, true, 1024, 1536, 3.5, 20] },
  { id: "flux-dev", base: "https://black-forest-labs-flux-1-dev.hf.space", ep: "/infer", args: (p, s) => [p, s, true, 1024, 1536, 3.5, 25] },
  { id: "sd35", base: "https://stabilityai-stable-diffusion-3-5-large.hf.space", ep: "/infer", args: (p, s) => [p, "blurry, low quality, text, watermark", s, true, 1024, 1536, 4.5, 24] },
];

async function hfImage(space, prompt) {
  const seed = Math.floor(Math.random() * 1000000);
  const call = `${space.base}/gradio_api/call${space.ep}`;
  const res = await fetch(call, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: space.args(prompt, seed) }),
  });
  if (!res.ok) throw new Error(space.id + " " + res.status);
  const { event_id } = await res.json();
  if (!event_id) throw new Error("no event");
  const sse = await fetch(`${call}/${event_id}`);
  const text = await sse.text();
  let payload = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { const arr = JSON.parse(line.slice(5)); if (Array.isArray(arr)) payload = arr; } catch {}
  }
  const file = payload && payload.find((x) => x && x.url);
  if (!file) throw new Error("no file");
  const img = await fetch(file.url);
  if (!img.ok) throw new Error("file " + img.status);
  return new Response(img.body, { headers: { ...CORS, "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" } });
}

export default {
  async fetch(request, env) {
    globalThis.__env = env;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/health") {
      return json({ ok: true, keys: pool(env).length, providers: Object.keys(PROVIDERS) });
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      const prompt = String(body.prompt || "").slice(0, 1200);
      if (!prompt) return json({ status: "failed", error: "prompt required" }, 400);
      const plan = await planFor(prompt);
      return json({ status: "ready", plan });
    }

    if (url.pathname === "/api/image") {
      const prompt = String(url.searchParams.get("prompt") || "").slice(0, 1200);
      if (!prompt) return json({ error: "prompt required" }, 400);

      // 0) Cloudflare Workers AI — free, runs inside Cloudflare, no key, very reliable.
      //    FLUX.1-schnell gives the best prompt adherence; SDXL is the portrait fallback.
      const wantTall = url.searchParams.get("shape") !== "square";
      if (env && env.AI) {
        try {
          const model = url.searchParams.get("model") || "@cf/black-forest-labs/flux-1-schnell";
          const out = model.includes("stability")
            ? await env.AI.run(model, { prompt, num_steps: 30, guidance: 7.5, width: 1024, height: 1536 })
            : await env.AI.run(model, { prompt, steps: 6 });
          if (out && out.image) {
            const bin = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
            if (bin.length > 3000) {
              return new Response(bin, {
                headers: { ...CORS, "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
              });
            }
          }
        } catch {}
      }

      // 1) FLUX / SD3.5 on public HF Spaces — best prompt adherence at 1024x1536.
      //    Runs from Cloudflare's network, so the visitor's ISP never matters.
      //    Two rounds: HF Spaces sometimes sleep and need a wake-up call.
      const deadline = Date.now() + 50000;
      for (const space of SPACES) {
        if (Date.now() > deadline) break;
        try {
          const out = await Promise.race([
            hfImage(space, prompt),
            new Promise((_, rej) => setTimeout(() => rej(new Error("space timeout")), 40000)),
          ]);
          if (out) return out;
        } catch {}
      }
      // 2) Pollinations fallback (free tier: 1 image per ~35s).
      const seed = Math.floor(Math.random() * 1e9);
      const poll = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1536&nologo=true&model=sana&referrer=mhzaly.surge.sh&seed=${seed}`;
      try {
        const r = await fetch(poll);
        const type = r.headers.get("content-type") || "";
        if (r.ok && type.startsWith("image/")) {
          return new Response(r.body, {
            headers: { ...CORS, "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
          });
        }
      } catch {}
      return json({ error: "image unavailable" }, 502);
    }

    return json({ error: "not found", routes: ["/health", "/api/generate", "/api/image"] }, 404);
  },
};
