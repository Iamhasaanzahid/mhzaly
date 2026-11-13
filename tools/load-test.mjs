#!/usr/bin/env node
/* ============================================================
   mhzaly — load test / capacity probe
   Hits the live site (and optionally the API) with N concurrent
   workers and reports throughput + latency percentiles.

   Usage:
     node tools/load-test.mjs --url https://mhzaly.pages.dev --concurrency 200 --duration 20
     node tools/load-test.mjs --url https://mhzaly-api.mhzaly.workers.dev/api/health --concurrency 100 --duration 15
   ============================================================ */

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const URL_TARGET = getArg('url', 'https://mhzaly.pages.dev/');
const CONCURRENCY = Math.max(1, Number(getArg('concurrency', 50)));
const DURATION = Math.max(1, Number(getArg('duration', 10)));
const PATH_EXTRA = getArg('path', '');

const latencies = [];
let ok = 0;
let failed = 0;
let bytes = 0;
let stop = false;

function percentile(p) {
  if (!latencies.length) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function worker(id) {
  let n = 0;
  while (!stop) {
    const started = process.hrtime.bigint();
    try {
      const res = await fetch(URL_TARGET + PATH_EXTRA, {
        headers: { 'User-Agent': `mhzaly-loadtest/${id}` },
        redirect: 'follow',
      });
      const buf = await res.arrayBuffer();
      bytes += buf.byteLength;
      if (res.status >= 200 && res.status < 400) ok += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    latencies.push(ms);
    n += 1;
    // tiny pause so the loop does not starve the event loop
    if (n % 50 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

console.log(`mhzaly load test → ${URL_TARGET}${PATH_EXTRA}`);
console.log(`concurrency: ${CONCURRENCY} · duration: ${DURATION}s\n`);

const startedAt = Date.now();
const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));

setTimeout(() => {
  stop = true;
}, DURATION * 1000);

await Promise.all(workers);
const elapsed = (Date.now() - startedAt) / 1000;
const total = ok + failed;

console.log('──────────── results ────────────');
console.log(`requests      : ${total}`);
console.log(`ok / failed   : ${ok} / ${failed} (${((failed / (total || 1)) * 100).toFixed(2)}% errors)`);
console.log(`throughput    : ${(total / elapsed).toFixed(1)} req/s`);
console.log(`bandwidth     : ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`p50 latency   : ${percentile(50).toFixed(1)} ms`);
console.log(`p95 latency   : ${percentile(95).toFixed(1)} ms`);
console.log(`p99 latency   : ${percentile(99).toFixed(1)} ms`);
console.log(`max latency   : ${Math.max(0, ...latencies).toFixed(1)} ms`);
console.log('─────────────────────────────────');
