/* ============================================================
   mhzaly — Dashboard
   ============================================================ */

import { db, lowStockProducts, totalSales, totalProfit } from '../db.js';
import { icon, esc } from '../ui.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function render(root) {
  const shop = db.settings.shopName || 'My Mart';
  const low = lowStockProducts();
  const sales = totalSales();
  const profit = totalProfit();

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>${greeting()}${db.settings.ownerName ? ', ' + esc(db.settings.ownerName) : ''} 👋</h2>
        <p>Here is what is happening at ${esc(shop)} today.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" data-nav="pos">${icon('plus')} New Sale</button>
        <button class="btn btn-ghost" data-nav="products">${icon('bag')} Add Product</button>
      </div>
    </div>

    <div class="stat-strip">
      <div><span class="lbl">Today Sales</span><b class="val">Rs ${esc(Number(sales || 0).toLocaleString())}</b></div>
      <div><span class="lbl">Profit</span><b class="val">Rs ${esc(Number(profit || 0).toLocaleString())}</b></div>
      <div><span class="lbl">Products</span><b class="val">${esc(db.products.length)}</b></div>
      <div><span class="lbl">Low Stock</span><b class="val">${esc(low.length)}</b></div>
    </div>

    <div class="grid k2 mt">
      <div class="card">
        <div class="card-head"><h3>Recent Sales</h3></div>
        <div class="card-pad">
          ${db.sales.length ? `<table style="width:100%"><thead><tr><th style="text-align:left">Invoice</th><th style="text-align:left">Customer</th><th style="text-align:right">Total</th></tr></thead><tbody>${db.sales.slice(-5).reverse().map((s) => `<tr><td>${esc(s.invoiceNo || s.id)}</td><td>${esc(s.customerName || 'Walk-in')}</td><td style="text-align:right">Rs ${Number(s.total || 0).toLocaleString()}</td></tr>`).join('')}</tbody></table>` : emptyState('No sales yet.')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Low Stock Alerts</h3></div>
        <div class="card-pad">
          ${low.length ? `<table style="width:100%"><thead><tr><th style="text-align:left">Product</th><th style="text-align:right">Stock</th><th style="text-align:right">Alert</th></tr></thead><tbody>${low.map((p) => `<tr><td>${esc(p.name)}</td><td style="text-align:right">${esc(p.stock)}</td><td style="text-align:right">${esc(p.lowStock)}</td></tr>`).join('')}</tbody></table>` : emptyState('All stock levels are good.')}
        </div>
      </div>
    </div>`;
}
