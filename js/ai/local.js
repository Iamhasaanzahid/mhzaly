/* ============================================================
   mhzaly — local LLM bridge (100% free, no paid API key)
   Works with:
     • Ollama            → http://localhost:11434
     • LM Studio         → http://localhost:1234/v1
     • llama.cpp server  → http://localhost:8080/v1
     • any OpenAI-compatible endpoint
   The model runs on the owner's own machine, so data never leaves it.
   Everything degrades gracefully: if no model is reachable the app
   keeps using the built-in offline AI.
   ============================================================ */

import { db } from '../db.js';

const CONNECT_TIMEOUT = 4000;
const GENERATE_TIMEOUT = 90000;

/** Well-known local endpoints to probe automatically. */
export const LOCAL_ENDPOINTS = [
  { url: 'http://localhost:11434', label: 'Ollama (default)' },
  { url: 'http://127.0.0.1:11434', label: 'Ollama (IPv4)' },
  { url: 'http://localhost:1234/v1', label: 'LM Studio' },
  { url: 'http://localhost:8080/v1', label: 'llama.cpp' },
  { url: 'http://localhost:11435', label: 'Ollama (alt port)' },
];

export function aiConfig() {
  const s = (db && db.settings) || {};
  return {
    mode: s.aiEngine === 'local' ? 'local' : 'builtin',
    endpoint: String(s.aiEndpoint || '').replace(/\/+$/, ''),
    model: String(s.aiModel || ''),
    key: String(s.aiKey || ''),
    temperature: Number.isFinite(Number(s.aiTemperature)) ? Number(s.aiTemperature) : 0.2,
  };
}

export function saveAiConfig(patch) {
  const s = db.settings;
  if (patch.mode) s.aiEngine = patch.mode === 'local' ? 'local' : 'builtin';
  if (patch.endpoint !== undefined) s.aiEndpoint = String(patch.endpoint || '').replace(/\/+$/, '');
  if (patch.model !== undefined) s.aiModel = String(patch.model || '');
  if (patch.key !== undefined) s.aiKey = String(patch.key || '');
  if (patch.temperature !== undefined) s.aiTemperature = Number(patch.temperature) || 0.2;
  return s;
}

async function withTimeout(promise, ms, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise(controller.signal);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`${label} time out ho gaya (${Math.round(ms / 1000)}s)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isOllama(endpoint) {
  return /11434|:1143\d|ollama/i.test(endpoint);
}

/** List models available on a local Ollama server. */
export async function listOllamaModels(endpoint) {
  const base = String(endpoint || '').replace(/\/+$/, '');
  const url = /\/v1$/.test(base) ? `${base}/models` : `${base}/api/tags`;
  const res = await withTimeout(
    (signal) => fetch(url, { signal, headers: { Accept: 'application/json' } }),
    CONNECT_TIMEOUT,
    'Server connect'
  );
  if (!res.ok) throw new Error(`Server ne ${res.status} return kiya`);
  const data = await res.json();
  const list = Array.isArray(data.models)
    ? data.models
    : Array.isArray(data.data)
      ? data.data
      : [];
  return list
    .map((m) => ({
      name: m.name || m.model || m.id || '',
      size: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : '',
      family: (m.details && m.details.family) || m.family || '',
    }))
    .filter((m) => m.name);
}

/** Probe the well-known local endpoints and report which ones answer. */
export async function discoverLocalModels() {
  const found = [];
  for (const candidate of LOCAL_ENDPOINTS) {
    try {
      const models = await listOllamaModels(candidate.url);
      found.push({ ...candidate, models, ok: true });
    } catch {
      /* endpoint not running — ignore */
    }
  }
  return found;
}

/** True when the endpoint looks reachable (fast health check). */
export async function ping(endpoint) {
  try {
    const models = await listOllamaModels(endpoint);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildMessages(system, user) {
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Ask the local model. Supports both the Ollama chat API and any
 * OpenAI-compatible /v1/chat/completions server.
 */
export async function askLocal(system, user, options = {}) {
  const cfg = aiConfig();
  const endpoint = (options.endpoint || cfg.endpoint || '').replace(/\/+$/, '');
  if (!endpoint) throw new Error('Local model endpoint set nahi hai');
  const model = options.model || cfg.model;
  if (!model) throw new Error('Model name select karein');
  const messages = buildMessages(system, user);

  if (isOllama(endpoint) && !/\/v1$/.test(endpoint)) {
    const res = await withTimeout(
      (signal) =>
        fetch(`${endpoint}/api/chat`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: {
              temperature: Number(options.temperature ?? cfg.temperature) || 0.2,
              num_ctx: 4096,
            },
          }),
        }),
      GENERATE_TIMEOUT,
      'Model'
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Model error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
    }
    const data = await res.json();
    const reply = data.message?.content || data.response || '';
    return { text: String(reply).trim(), model: data.model || model, engine: 'ollama' };
  }

  // OpenAI-compatible (LM Studio, llama.cpp, vLLM, Jan, …)
  const headers = { 'Content-Type': 'application/json' };
  const key = options.key ?? cfg.key;
  if (key) headers.Authorization = `Bearer ${key}`;
  const base = /\/v1$/.test(endpoint) ? endpoint : `${endpoint}/v1`;
  const res = await withTimeout(
    (signal) =>
      fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          temperature: Number(options.temperature ?? cfg.temperature) || 0.2,
        }),
      }),
    GENERATE_TIMEOUT,
    'Model'
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Model error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || '';
  return { text: String(reply).trim(), model, engine: 'openai-compatible' };
}
