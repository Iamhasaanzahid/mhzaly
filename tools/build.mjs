#!/usr/bin/env node
/* ============================================================
   mhzaly — production build
   1. clean dist/
   2. copy only the files that may be published
   3. run the security gate (blocks the build on any leak)
   ============================================================ */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const root = process.cwd();
const dist = path.join(root, 'dist');

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

console.log('✓ dist/ built');

execFileSync(process.execPath, [path.join(root, 'tools', 'security-scan.mjs'), dist], { stdio: 'inherit' });

const size = fs.readdirSync(dist).length;
console.log(`\n✓ Build ready (${size} top-level entries). Deploy with:`);
console.log('  npx -y wrangler@4.158.0 pages deploy dist --project-name mhzaly --branch main --commit-dirty=true');
