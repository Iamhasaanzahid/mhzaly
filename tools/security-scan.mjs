#!/usr/bin/env node
/* ============================================================
   mhzaly — pre-deploy security gate
   Scans the built dist/ folder for anything that must never be
   published (secrets, VCS data, archives, keys) and verifies the
   security control files are present. Exits non-zero on failure so
   a leaky build can never reach Cloudflare Pages.

   Usage: node tools/security-scan.mjs [dist]
   ============================================================ */

import fs from 'fs';
import path from 'path';

const root = process.argv[2] || 'dist';
const problems = [];
const warnings = [];

/* ---------- forbidden file patterns ---------- */
const FORBIDDEN_NAMES = [
  /^\.env(\..*)?$/i,
  /^\.git/i,
  /^\.npmrc$/i,
  /^\.aws/i,
  /^\.ssh/i,
  /^\.htaccess$/i,
  /^\.DS_Store$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.keystore$/i,
  /\.jks$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(zip|tar|tgz|gz|bz2|7z|rar)$/i,
  /\.(sql|dump)$/i,
  /\.(log)$/i,
  /\.(bak|old|orig|swp)$/i,
  /~$/,
];

const FORBIDDEN_DIRS = new Set(['.git', '.env', '.github', 'node_modules', '.wrangler', '.dev.vars', 'server', 'cloudflare', 'tools']);

/* ---------- secret patterns ---------- */
const SECRET_PATTERNS = [
  { name: 'Cloudflare API token', re: /\b(?:v1\.0-|[A-Za-z0-9_-]{37,40})\b(?=[^\n]{0,20}CF_API|CLOUDFLARE_API_TOKEN)/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[0-9A-Za-z]{10,}\b/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Generic JWT secret assignment', re: /AUTH_SECRET\s*[:=]\s*['"][^'"]{12,}['"]/i },
  { name: 'Hardcoded password assignment', re: /(?:password|passwd)\s*[:=]\s*['"][^'"\s]{8,}['"]/i },
];

/* ---------- files that must exist ---------- */
const REQUIRED = ['index.html', 'sw.js', '_headers', '404.html', 'manifest.json', 'js/app.js'];

/* ---------- files that must never be published ---------- */
const FORBIDDEN_PUBLISH = ['server/worker.js', 'cloudflare/worker.js', 'server/schema.sql', 'tools/security-scan.mjs'];

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (FORBIDDEN_DIRS.has(entry.name)) {
        problems.push(`Forbidden directory in build: ${rel}/`);
        continue;
      }
      out.push(...walk(full, base));
    } else {
      out.push({ full, rel });
    }
  }
  return out;
}

if (!fs.existsSync(root)) {
  console.error(`✘ Build folder not found: ${root}`);
  process.exit(1);
}

const files = walk(root);

for (const file of files) {
  if (FORBIDDEN_NAMES.some((re) => re.test(file.rel))) {
    problems.push(`Forbidden file in build: ${file.rel}`);
    continue;
  }
  if (!/\.(js|mjs|css|html|json|txt|xml|webmanifest|svg|md)$/i.test(file.rel)) continue;
  if (file.rel.length > 400000) continue;
  let text = '';
  try {
    text = fs.readFileSync(file.full, 'utf8');
  } catch {
    continue;
  }
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) problems.push(`Possible ${name} inside ${file.rel}`);
  }
  // hardcoded absolute API hosts other than the production API
  const hosts = text.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  for (const host of hosts) {
    if (/mhzaly\.pages\.dev|mhzaly-api\.mhzaly\.workers\.dev|wa\.me|api\.whatsapp\.com/.test(host)) continue;
    if (/w3\.org|schema\.org|github\.com|creativecommons/.test(host)) continue;
    if (/d-project\.com|opensource\.org|denso-wave\.com|stackoverflow\.com|sitemaps\.org/.test(host)) continue;
    warnings.push(`External host referenced in ${file.rel}: ${host}`);
  }
}

for (const req of REQUIRED) {
  if (!fs.existsSync(path.join(root, req))) problems.push(`Missing required build file: ${req}`);
}
for (const bad of FORBIDDEN_PUBLISH) {
  if (fs.existsSync(path.join(root, bad))) problems.push(`Server-side file must not be published: ${bad}`);
}

console.log(`mhzaly security gate — scanned ${files.length} files in ${root}/`);
if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 20)) console.log('  - ' + w);
}
if (problems.length) {
  console.error(`\n✘ ${problems.length} problem(s) found — build blocked:`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\n✓ No secrets, no VCS data, no archives — safe to publish.');
console.log('✓ Security headers (_headers), 404 page and service worker present.');
