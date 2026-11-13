#!/usr/bin/env node
/* ============================================================
   mhzaly — production build
   1. clean dist/
   2. copy only the files that may be published
   3. stamp every local asset with ?v=<version> so the CDN can
      cache it immutably for a year (10M users → 0 origin hits)
   4. run the security gate (blocks the build on any leak)
   ============================================================ */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const root = process.cwd();
const dist = path.join(root, 'dist');

/* ---------- version stamp ---------- */
function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
const contentHash = crypto
  .createHash('sha1')
  .update(
    fs
      .readdirSync(path.join(root, 'js'))
      .sort()
      .map((f) => `js/${f}`)
      .join('|') + '|' + fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8').length
  )
  .digest('hex')
  .slice(0, 8);
const VERSION = process.env.MHZALY_VERSION || gitSha() || contentHash;

const FILES = [
  'index.html',
  'owner.html',
  'verify.html',
  '404.html',
  'icon.svg',
  'manifest.json',
  'sw.js',
  'robots.txt',
  'sitemap.xml',
  '_headers',
  '_redirects',
];

const DIRS = ['css', 'js'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of FILES) {
  const src = path.join(root, file);
  if (!fs.existsSync(src)) {
    console.error(`✘ Missing source file: ${file}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(dist, file));
}

for (const dir of DIRS) {
  const src = path.join(root, dir);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(dist, dir), { recursive: true });
}

/* ---------- version the HTML asset references ---------- */
const VERSIONABLE = /^\.\/(js\/|css\/|icon\.svg$|manifest\.json$)/;
for (const file of ['index.html', 'owner.html', 'verify.html', '404.html']) {
  const target = path.join(dist, file);
  let html = fs.readFileSync(target, 'utf8');
  html = html.replace(/(src|href)="([^"]+)"/g, (match, attr, url) => {
    if (!VERSIONABLE.test(url)) return match;
    const clean = url.split('?')[0];
    return `${attr}="${clean}?v=${VERSION}"`;
  });
  fs.writeFileSync(target, html);
}

/* ---------- version the service worker cache + assets ---------- */
const swPath = path.join(dist, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE = '[^']+';/, `const CACHE = 'mhzaly-${VERSION}';`);
sw = sw.replace(/'(\.\/[^']*)'/g, (match, url) => {
  if (!VERSIONABLE.test(url)) return match;
  const clean = url.split('?')[0];
  return `'${clean}?v=${VERSION}'`;
});
fs.writeFileSync(swPath, sw);

console.log(`✓ dist/ built (version ${VERSION})`);

execFileSync(process.execPath, [path.join(root, 'tools', 'security-scan.mjs'), dist], { stdio: 'inherit' });

const size = fs.readdirSync(dist).length;
console.log(`\n✓ Build ready (${size} top-level entries, assets immutable for 1 year). Deploy with:`);
console.log('  npx -y wrangler@4.158.0 pages deploy dist --project-name mhzaly --branch main --commit-dirty=true');
