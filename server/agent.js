/* ============================================================
   MHZALY AR — Agentic AI orchestration
   Prompt / image -> plan -> generate -> AR job

   Providers:
   - AI_API_KEY set  -> any OpenAI-compatible endpoint (AI_BASE_URL/AI_MODEL)
   - no key          -> free keyless Pollinations (text.pollinations.ai/openai)
   - provider down   -> local demo plan (never blocks the flow)
   ============================================================ */
import crypto from "node:crypto";

const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.openai.com/v1";
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o";
const FREE_AI_URL = "https://text.pollinations.ai/openai";
const FREE_AI_MODEL = process.env.FREE_AI_MODEL || "openai";

const jobs = new Map(); // jobId -> { jobId, type, prompt, image, status, createdAt }

function newJobId() {
  return crypto.randomBytes(8).toString("hex");
}

const AGENT_SYSTEM = `You are MHZALY's agentic AR engine.
You turn user intent (text prompt or image) into a 3D AR asset job.
Respond ONLY with JSON:
{
  "assetType": "3d-model" | "face-filter" | "text" | "svg",
  "style": "photoreal" | "stylized",
  "description": "short creative brief",
  "targetUnits": "meters"
}`;

function demoPlan({ type, prompt, image }) {
  const words = (prompt || "").trim().split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return {
    assetType: type || "3d-model",
    style: "photoreal",
    description: words
      ? `3D AR asset — ${words}`
      : image
        ? "3D AR asset generated from your image"
        : "3D AR asset",
    targetUnits: "meters",
  };
}

function applyPlan(job, plan, mode) {
  job.status = "planned";
  job.mode = mode;
  job.plan = plan;
  job.output = {
    assetType: plan.assetType || job.type,
    style: plan.style || "photoreal",
    description: plan.description || job.prompt,
    imageReceived: Boolean(job.image),
  };
  return job;
}

export async function runAgent({ type, prompt, image } = {}) {
  const jobId = newJobId();
  const job = { jobId, type: type || "3d-model", prompt: prompt || "", image: image || null, status: "queued", createdAt: Date.now() };
  jobs.set(jobId, job);

  const userContent = [];
  if (image) {
    userContent.push({ type: "text", text: prompt || "Turn this into a 3D AR asset" });
    userContent.push({ type: "image_url", image_url: { url: image } });
  } else {
    userContent.push({ type: "text", text: prompt || "Create a 3D AR asset" });
  }

  const useKey = Boolean(AI_API_KEY);
  const endpoint = useKey ? `${AI_BASE_URL}/chat/completions` : FREE_AI_URL;
  const model = useKey ? AI_MODEL : FREE_AI_MODEL;
  const headers = { "Content-Type": "application/json" };
  if (useKey) headers.Authorization = `Bearer ${AI_API_KEY}`;

  try {
    const completion = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: AGENT_SYSTEM },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
      }),
    });

    if (!completion.ok) throw new Error(`provider ${completion.status}`);

    const data = await completion.json();
    const text = data?.choices?.[0]?.message?.content || "";
    let plan;
    try {
      plan = JSON.parse(text);
    } catch {
      plan = { ...demoPlan({ type, prompt, image }), description: text.slice(0, 240) || demoPlan({ type, prompt, image }).description };
    }
    return applyPlan(job, plan, useKey ? "live" : "free");
  } catch (err) {
    job.error = String(err.message || err);
    return applyPlan(job, demoPlan({ type, prompt, image }), "demo");
  }
}

export async function getJob(jobId) {
  return jobs.get(jobId) || null;
}
