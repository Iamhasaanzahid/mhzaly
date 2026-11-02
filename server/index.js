import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8788;

app.use(express.json({ limit: "25mb" }));

/* ---------------- tiny in-memory store ---------------- */
const users = new Map(); // email -> { email, passwordHash, createdAt }
const ars = new Map(); // id -> { id, owner, type, source, status, createdAt }
const tokens = new Map(); // token -> email

function hash(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

/* ---------------- health ---------------- */
app.get("/api/health", (req, res) => res.json({ ok: true, service: "mhzaly-ar", time: Date.now() }));

/* ---------------- auth ---------------- */
app.post("/api/auth/signup", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const key = String(email).toLowerCase();
  if (users.has(key)) return res.status(409).json({ error: "user exists" });
  users.set(key, { email: key, passwordHash: hash(password), createdAt: Date.now() });
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, key);
  return res.json({ token, email: key });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const key = String(email || "").toLowerCase();
  const u = users.get(key);
  if (!u || u.passwordHash !== hash(String(password || ""))) return res.status(401).json({ error: "bad credentials" });
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, key);
  return res.json({ token, email: key });
});

app.post("/api/auth/logout", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  tokens.delete(token);
  return res.json({ ok: true });
});

/* ---------------- AR experiences ---------------- */
app.get("/api/ar", (req, res) => res.json({ ars: [...ars.values()] }));

app.post("/api/ar", (req, res) => {
  const { type, source } = req.body || {};
  if (!type) return res.status(400).json({ error: "type required" });
  const id = crypto.randomBytes(8).toString("hex");
  ars.set(id, { id, type, source: source || null, status: "ready", createdAt: Date.now() });
  return res.json({ id, type, status: "ready" });
});

app.get("/api/ar/:id", (req, res) => {
  const ar = ars.get(req.params.id);
  if (!ar) return res.status(404).json({ error: "not found" });
  return res.json({ ar });
});

app.post("/api/ar/:id/scan", (req, res) => {
  const ar = ars.get(req.params.id);
  if (!ar) return res.status(404).json({ error: "not found" });
  ar.scans = (ar.scans || 0) + 1;
  return res.json({ ok: true, scans: ar.scans });
});

app.get("/api/ar/:id/qr", (req, res) => {
  const ar = ars.get(req.params.id);
  if (!ar) return res.status(404).json({ error: "not found" });
  const qrPath = path.join(__dirname, "data", `qr-${ar.id}.png`);
  fs.mkdirSync(path.dirname(qrPath), { recursive: true });
  // Minimal QR fallback is client-side; here we just acknowledge the slot.
  fs.writeFileSync(qrPath, "mhzaly-ar:" + ar.id);
  return res.json({ qrToken: "mhzaly-ar:" + ar.id, id: ar.id });
});

/* ---------------- AI generation stub ---------------- */
app.post("/api/generate", (req, res) => {
  const { type, prompt, image } = req.body || {};
  if (!prompt && !image) return res.status(400).json({ error: "prompt or image required" });
  // Real generation calls go through provider keys; kept as pending job slot for v1.
  const jobId = crypto.randomBytes(8).toString("hex");
  return res.json({ jobId, status: "queued", type });
});

/* ---------------- static frontend ---------------- */
const siteDir = path.resolve(__dirname, "..", "site");
app.use(express.static(siteDir));
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(siteDir, "index.html"));
});

app.listen(PORT, () => console.log(`MHZALY AR backend listening on http://localhost:${PORT}`));
