# mhzaly — Scaling & capacity plan (10M concurrent users)

Target: **10,000,000 users hitting the app at the same time**, without the site slowing
down and without a bill shock. This document states what is already done, what the
real limits are, and the exact next steps if traffic really arrives.

## 1. Where the traffic actually goes

```
10M users ──► Cloudflare edge (static assets)   ← 100% of page views
          └─► Cloudflare Worker API (auth + sync) ← only on login/save
                └─► D1 (SQLite)                    ← the real bottleneck
```

The app is **static-first**: every screen (dashboard, POS, reports, AI, tax, QR) is
plain JavaScript running in the browser against `localStorage`. The origin only sees
two things: the HTML shell and the JS/CSS assets.

## 2. What is already in place

| Layer | Measure | Effect at 10M |
|---|---|---|
| Assets | `?v=<sha>` + `Cache-Control: public, max-age=31536000, immutable` | Returning users download **0 bytes** of assets |
| App shell | `s-maxage=600, stale-while-revalidate=86400` | HTML is served from the CDN edge, origin untouched |
| Service worker | network-first + versioned cache | Repeat visits work offline, no origin hit |
| CDN | Cloudflare Pages (anycast, 300+ PoPs) | Static delivery scales horizontally — this is not a server you can outgrow |
| API reads | ETag on `/api/bootstrap` → `304` | Unchanged shop data = 0 bytes |
| API public read | `/api/shop` is `public, s-maxage=600` | Cached at the edge |
| Rate limiting | in-isolate fast path + D1 every 5th hit | D1 is not hammered on every request |
| DB | 15 indexes incl. `shops(status)`, `audit_log(target_id, created_at)` | Queries stay O(log n) |
| Sync | client debounce 700 ms + 3 s flush | One write per burst, not one per keystroke |
| Edge cache rules | `_headers` + `_redirects` | Probes/attacks hit the edge, not D1 |

## 3. Honest limits (and the plan for each)

### a) D1 write throughput — the hard ceiling
D1 is a SQLite database: **one writer at a time**. With 10M users, the shop-data
`PUT /api/data` writes would be the first thing to saturate.

Plan (in order of effort):
1. **Ship as-is** — the client already batches writes; 10M *page views* is not
   10M writes. A shop bills a few times a minute, so writes ≈ users × 0.1/min.
2. **Sharding** — split D1 into N databases by `shop_id` hash and route by shop id.
   D1 supports many databases per Worker.
3. **Event stream** — workers append mutations to a queue/KV and a nightly job
   compacts them into the shop blob (the client already owns the full dataset).
4. **KV as the read path** — mirror `shop_data` to KV (globally replicated, read-fast)
   and keep D1 as the write-ahead log.

### b) Worker request cost
The Worker is on the free/paid Workers tier. 10M page views ≈ 10M static hits
(no Worker) + maybe 100k–1M API hits (Worker). The API cost is therefore ~1–10%
of the traffic — affordable. Register/login are the only expensive endpoints
(PBKDF2 hashing) and are already rate-limited + locked out.

### c) First-visit stampede
The very first request for a new asset version can fan out. Mitigation already in
place: `stale-while-revalidate` on the shell + immutable assets + the SW cache.
For a launch, pre-warm the asset URLs from several regions.

### d) Regional data residency
D1 is global-replicated but single-writer. If the user base is genuinely worldwide,
plan the KV/R2 hybrid described above before onboarding 10M shops.

## 4. Load testing

```bash
# 200 concurrent workers against the app shell for 30 seconds
node tools/load-test.mjs --url https://mhzaly.pages.dev/ --concurrency 200 --duration 30

# against the API
node tools/load-test.mjs --url https://mhzaly-api.mhzaly.workers.dev/api/health --concurrency 100 --duration 20
```

The tool reports throughput, p50/p95/p99 latency and the error rate. Run it from a
region close to your users (results from a distant machine measure the network, not
the site).

## 5. Operational checklist before a big launch

- [x] Static assets immutable + versioned
- [x] HTML edge-cached with SWR
- [x] ETag on the shop payload
- [x] Rate limiting with lockout on auth endpoints
- [x] D1 indexes for every hot query
- [ ] Enable Cloudflare **Cache Rules** for `/js/*` and `/css/*` (belt & braces)
- [ ] Turn on **Cloudflare Rate Limiting / WAF** rules for `/api/*`
- [ ] Turn on **D1 read replication** (`with_session`/`first primary` strategy)
- [ ] Enable **Workers Paid** plan (10M static hits are free, but API bursts are not)
- [ ] Set up **D1 PITR backups** + a daily export to R2
- [ ] Point a custom domain and enable **WAF Managed Rules** + Bot Fight Mode
- [ ] Load test from 3 regions at 5k/10k/50k concurrency before launch
- [ ] Alerting: Worker error rate, D1 latency, 5xx ratio, rate-limit rejects

## 6. Quick facts

- App payload today: ~660 KB total, ~120 KB of JS on first load, **0 KB** afterwards.
- No server-side rendering, no third-party scripts, no external fonts, no analytics.
- All intelligence (Pulse, leaks, restock, forecast, tax QR) runs **on-device** —
  more users cost the server *nothing*.
