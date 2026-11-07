# mhzaly 🛒

**mhzaly** is a simple online shop manager for marts, kiryana stores and general stores.
Every shop gets its **own login and its own data** — inventory, POS billing, purchases,
customer khata, supplier payments, expenses and profit reports, all in one place.

- **Live app:** https://mhzaly.pages.dev/
- **Demo:** open the live app and click **Try a demo shop** (no account needed)

![mhzaly](https://img.shields.io/badge/status-live-0d9488) ![Multi-shop](https://img.shields.io/badge/multi--shop-accounts-0f766e) ![Cloud sync](https://img.shields.io/badge/cloud-synced-115e59) ![License MIT](https://img.shields.io/badge/license-MIT-blue)

---

## What each shop gets

| Area | What you can do |
| --- | --- |
| **Dashboard** | Today's sales & profit, 7-day sales chart, low-stock alerts, top products, receivables |
| **New Sale (POS)** | Search or scan barcode, tap to add, quantity controls, discount, tax, cash/card/bank/udhaar, change calculation, printable receipt |
| **Products** | Add/edit products, SKU/barcode, category, unit, cost & selling price, stock, per-product low-stock alert, CSV export |
| **Sales** | Invoice history, search & date filters, view details, reprint receipt, void a sale (stock is restored) |
| **Purchases** | Record stock received from suppliers, auto stock-in, update cost price, track payable |
| **Customers & Khata** | Customer list, udhaar balance, receive payments, full ledger with running balance |
| **Suppliers** | Supplier list, purchase history, payable balance, record payments |
| **Expenses** | Rent, utilities, salary, transport and other shop costs |
| **Reports** | Date-range revenue, gross profit, expenses, net profit, sales trend, top products, category & payment breakdown, CSV export |
| **Settings** | Shop details, currency, tax, shop login link, password change, backup/restore, demo data |

- **Category-based catalogue** — choose your shop type at signup and get 12 matching starter
  products with starting stock: Mart / Kiryana, Mobile Shop, Electronics, Medical Store,
  Clothing, Cosmetics, Stationery, Hardware, Bakery or General Store. "Other" starts empty.
  Add or edit as many products as you like.
- **Barcode ready** — any USB/Bluetooth barcode scanner that types text works in the POS search box.
- **Printable receipts** — 80mm-style thermal receipt layout using the browser print dialog.
- **Works offline** — data is cached in the browser, so billing keeps working during internet outages
  and syncs when you are back online.
- **PWA** — install it on a phone or desktop like a normal app.

---

## Create your shop

1. Open **https://mhzaly.pages.dev/**
2. Click **Create a shop**, choose your **shop category**, then enter your **shop name**,
   **shop phone number** and a **password**.
3. Your request goes to the mhzaly owner (**mhzcyb@gmail.com**) for approval. The owner
   receives an email with **Approve** and **Reject** buttons.
4. After approval, log in with your **phone number** (or shop code) and the password you chose.
5. Your shop gets a **shop code** (for example `al-madina`) and 12 starter products matching
   the category you selected. The shop name and phone number you entered appear on every receipt.
6. Go to **Settings → Account & cloud sync** to copy your shop's own login link:
   `https://mhzaly.pages.dev/?shop=al-madina`

You can log in with **your phone number, your shop code, or your email** plus the same password.

> **Shop login page:** opening `?shop=<your-code>` shows a branded login page for that shop.
> Share it with staff or save it on the shop computer.

> **Approval panel (owner):** if an approval email does not arrive, the owner can open the
> private admin link (`/api/admin?key=...`) and approve or reject pending shops there.

---

## Accounts, data & sync

- Each shop has a separate account and a separate database row. Shops cannot see each other's data.
- Passwords are stored as **PBKDF2-SHA256** hashes (60,000 iterations, random salt).
- Login sessions use signed **HMAC-SHA256** tokens that expire after 30 days.
- The browser keeps a **local cache** for offline use; changes are synced to the cloud
  automatically a moment after you make them.
- The header shows the sync status: **Saving… → Saved**, or **Offline** if the connection drops.
- **Backup:** Settings → Backup & restore downloads a full JSON archive at any time.
- **Delete account:** Settings → Account & cloud sync permanently removes the shop and all its
  cloud data. Download a backup first if you might need it.

Cloud data is stored in **Cloudflare D1** (SQLite). The frontend is static and hosted on
**GitHub Pages**; the API runs as a **Cloudflare Worker**.

---

## Run locally

No build tools or npm are required.

```bash
git clone https://github.com/Iamhasaanzahid/mhzaly.git
cd mhzaly
python3 -m http.server 8080
# open http://localhost:8080
```

The app uses ES modules, so `file://` will not work. The deployed API allows
`http://localhost` / `http://127.0.0.1` origins for local development.

---

## Deploy your own

### 1. Backend — Cloudflare Worker + D1

```bash
# inside the repo
npx wrangler d1 create mhzaly
# copy the database_id into server/metadata.json, then:
npx wrangler d1 execute mhzaly --remote --file=server/schema.sql
npx wrangler deploy server/worker.js --name mhzaly-api
npx wrangler secret put AUTH_SECRET --name mhzaly-api
```

Bind the D1 database to the Worker as **`DB`**, enable the `workers.dev` route, then test:

```bash
curl https://mhzaly-api.<your-subdomain>.workers.dev/api/health
```

Update `API_BASE` in `js/api.js` and the allowed origin in `server/worker.js` (`corsHeaders`)
if you use a different account or domain.

### 2. Frontend — GitHub Pages

1. Push this repository to GitHub.
2. **Settings → Pages → Deploy from a branch** → `main`, folder `/ (root)`.
3. The app will be live at `https://<username>.github.io/mhzaly/`.

Any static host works (Netlify, Vercel, Cloudflare Pages) — publish directory `/`, no build command.

---

## Project layout

```
index.html
css/styles.css
js/
  api.js        # API client, session storage, cloud sync
  app.js        # auth gate, app shell, hash router
  db.js         # data model, local cache, common products, sample data
  ui.js         # shared UI helpers, modal, toast, icons
  receipt.js    # printable receipt
  pages/
    auth.js     # login / create shop / demo
    dashboard.js, pos.js, products.js, sales.js, purchases.js,
    customers.js, suppliers.js, expenses.js, reports.js, settings.js
server/
  worker.js     # Cloudflare Worker API
  schema.sql    # D1 schema (shops, users, shop_data)
sw.js
manifest.json
```

### API quick reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/register` | Create shop + owner account |
| `POST` | `/api/login` | Login with email or shop code |
| `GET` | `/api/bootstrap` | Load the logged-in shop's data |
| `PUT` | `/api/data` | Save shop data |
| `GET` | `/api/shop?code=` | Public shop name for a branded login page |
| `POST` | `/api/password` | Change password |
| `DELETE` | `/api/account` | Delete shop account and data |

---

## Roadmap ideas

- Staff accounts with limited permissions
- Urdu / RTL interface
- Barcode label printing
- WhatsApp invoice sharing
- Inventory import from CSV

Contributions and suggestions are welcome — open an issue.

---

## License

MIT © 2026
