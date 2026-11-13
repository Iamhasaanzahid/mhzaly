# mhzaly — Security Posture

Last hardening pass: 2026-11-12 · scope: `mhzaly.pages.dev` (static app) + `mhzaly-api.mhzaly.workers.dev` (API)

## Audit findings and their resolution

An external scan reported ten "exposed files" (`/git/config`, `/backup.zip`, `/api/v1/users`,
`/swagger.ui`, `/phpinfo.php`, `/graphql`, `/xmlrpc.php`, `/api/v1/health`, `/v2/swagger.json`,
`/metrics`) and four missing security headers.

**Verification:** every one of those URLs returned the *same* 654-byte `index.html`
(Cloudflare Pages SPA fallback) — no VCS data, backup or configuration file was ever public.
The findings were false positives caused by a `200` status on unknown paths.

| Finding | Root cause | Fix | Status |
|---|---|---|---|
| 10 × "exposed files" (HTTP 200) | Pages SPA fallback served the app shell for every unknown path | `404.html` added → unknown paths now return a real **404**; `_redirects` blocks the probed paths explicitly | ✅ |
| Missing `Strict-Transport-Security` | no `_headers` file | HSTS `max-age=63072000; includeSubDomains; preload` | ✅ |
| Missing `Content-Security-Policy` | no `_headers` file | Strict CSP, `default-src 'self'`, `frame-ancestors 'none'` | ✅ |
| Missing `X-Frame-Options` | no `_headers` file | `DENY` | ✅ |
| Missing `X-XSS-Protection` | no `_headers` file | `0` (OWASP-recommended value — legacy auditor is harmful) | ✅ |

## Controls now in place

### Edge / transport
- HSTS (2 years, includeSubDomains, preload), `upgrade-insecure-requests` in CSP.
- `X-Frame-Options: DENY` + `frame-ancestors 'none'` → clickjacking blocked.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` disables camera, mic, geolocation, payment, USB, etc.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`,
  `Origin-Agent-Cluster: ?1`, `X-Permitted-Cross-Domain-Policies: none`.
- `owner.html` and `verify.html` are `no-store` + `noindex, nofollow`.

### Application
- **CSP without `unsafe-inline` for scripts** — the app has zero inline scripts and zero inline
  event handlers; print windows are driven from the opener instead of inline `<script>`.
- No third-party scripts, no external fonts, no analytics, no CDN dependencies.
- Service worker: network-first with `no-cache` revalidation, only successful same-origin
  responses are cached, and the offline shell is served **only** for the app root — probes like
  `/git/config` always get a hard 404, even offline.
- Service worker cache names are versioned (`mhzaly-v32`) with an in-app update prompt.

### API (`mhzaly-api.mhzaly.workers.dev`)
- CORS allow-list: production origin, `*.mhzaly.pages.dev` previews, and localhost only.
- PBKDF2-SHA256 password hashing with per-user salt, HMAC-signed tokens, constant-time compare.
- Password strength policy, login lockout after 5 failed attempts, per-IP rate limiting.
- All API responses carry the same security headers.

### Build pipeline
- `node tools/build.mjs` copies only the publishable files, then runs `tools/security-scan.mjs`.
- The gate **fails the build** if the output contains `.env`, `.git`, keys, certificates,
  archives, SQL dumps, logs or any hardcoded secret pattern (Cloudflare/AWS/Google/Stripe/Slack
  keys, `PRIVATE KEY` blocks, hardcoded passwords or `AUTH_SECRET` assignments).
- The gate also asserts that `_headers`, `404.html`, `sw.js` and `manifest.json` are present and
  that server-side worker code is *not* published.

## Publishing rules
- Only `dist/` is deployed — never the repository root.
- `.git`, `server/`, `cloudflare/`, `tools/` and `node_modules/` are excluded from `dist/`.
- The shop token lives in `localStorage`; the strict CSP is the primary XSS mitigation.

## Re-testing
```bash
curl -I https://mhzaly.pages.dev/git/config      # → 404 (not 200)
curl -I https://mhzaly.pages.dev/                 # → 200 + security headers
node tools/security-scan.mjs dist                # → must print "safe to publish"
```
