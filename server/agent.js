/* ============================================================
   MHZALY AR — Agentic AI orchestration
   Prompt / image -> plan -> generate -> AR job
   Provider: OpenAI-compatible chat completions endpoint
   ============================================================ */
import crypto from "node:crypto";

const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.openai.com/v1";
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o";

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

export async function runAgent({ type, prompt, image } = {}) {
  const jobId = newJobId();
  const job = { jobId, type: type || "3d-model", prompt: prompt || "", image: image || null, status: "queued", createdAt: Date.now() };
  jobs.set(jobId, job);

  if (!AI_API_KEY) {
    job.status = "failed";
    job.error = "AI_API_KEY not configured";
    return job;
  }

  const userContent = [];
  if (image) {
    userContent.push({ type: "text", text: prompt || "Turn this into a 3D AR asset" });
    userContent.push({ type: "image_url", image_url: { url: image } });
  } else {
    userContent.push({ type: "text", text: prompt || "Create a 3D AR asset" });
  }

  const completion = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: AGENT_SYSTEM },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
    }),
  });

  if (!completion.ok) {
    job.status = "failed";
    job.error = `AI provider error ${completion.status}`;
    return job;
  }

  const data = await completion.json();
  const text = data?.choices?.[0]?.message?.content || "{}";
  let plan = {};
  try {
    plan = JSON.parse(text);
  } catch {
    plan = { assetType: "3d-model", style: "photoreal", description: text, targetUnits: "meters" };
  }

  job.status = "planned";
  job.plan = plan;
  job.output = { assetType: plan.assetType || job.type, style: plan.style || "photoreal", description: plan.description || prompt };
  return job;
}

export async function getJob(jobId) {
  return jobs.get(jobId) || null;
}
