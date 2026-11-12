# mhzaly — Shop Manager

Simple online shop manager for marts, mobile shops, pharmacies and general stores.

- POS billing, barcode scan, discounts, held bills
- Inventory, purchases, suppliers, customer khata
- Returns & refunds, expenses, profit reports
- Offline-first PWA with local database
- Free offline AI assistant
- Light / Dark / System theme

## Live

https://mhzaly.pages.dev

## Structure

- `index.html` — shop app shell
- `owner.html` — owner panel
- `css/` — styles (light + dark)
- `js/` — app, database, pages, AI assistant
- `server/worker.js` — Cloudflare Worker API (D1)
- `cloudflare/worker.js` — Cloudflare AI proxy (optional)

## Deploy (Cloudflare Pages)

```bash
mkdir -p dist
cp -R index.html owner.html css js icon.svg manifest.json sw.js robots.txt sitemap.xml dist/
npx wrangler pages deploy dist --project-name mhzaly --branch main
```

## API Worker

```bash
cd server
npx wrangler deploy
```
