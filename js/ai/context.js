/* ============================================================
   mhzaly — AI context builder
   Turns the shop database into a compact, structured snapshot that a
   local LLM can reason over. No raw personal data is exported beyond
   what the owner already sees in their own shop.
   ============================================================ */

import { db } from '../db.js';
import {
  businessHealth, profitLeaks, restockPlan, customerSegments, customerRisk,
  dayCloseSummary, taxSummary, forecastNext7, salesInDays, topProducts, topCustomers,
  sumBy, saleProfit, paymentMix,
} from '../insights.js';
import { moneySettings } from '../currency.js';

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/** Compact snapshot of the shop for the AI. */
export function buildShopContext() {
  const s = db.settings || {};
  const health = businessHealth();
  const leaks = profitLeaks();
  const plan = restockPlan({ days: 30 });
  const segments = customerSegments();
  const tax = taxSummary(30);
  const forecast = forecastNext7();
  const today = dayCloseSummary();
  const cur = moneySettings();

  const sales30 = salesInDays(30);
  const revenue30 = sumBy(sales30, 'total');
  const profit30 = sales30.reduce((sum, x) => sum + saleProfit(x), 0);
  const expenses30 = sumBy(salesInDays(30), 'total');
  const mix = paymentMix(sales30).map(([method, value]) => ({ method, value: round(value) }));

  const products = (db.products || [])
    .map((p) => {
      const price = Number(p.price) || 0;
      const cost = Number(p.cost) || 0;
      const stock = Number(p.stock) || 0;
      const lowStock = Number(p.lowStock) || 5;
      const sold = plan.rows.find((row) => row.product.id === p.id);
      return {
        name: p.name,
        sku: p.sku || '',
        category: p.category || '',
        stock,
        lowStock,
        cost: round(cost),
        price: round(price),
        marginPct: price ? round(((price - cost) / price) * 100, 1) : 0,
        sold30: sold ? sold.sold : 0,
        coverDays: sold && sold.cover != null ? Math.round(sold.cover) : null,
        status: stock <= 0 ? 'out' : stock <= lowStock ? 'low' : sold && sold.cover != null && sold.cover <= 7 ? 'reorder' : 'ok',
      };
    })
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 60);

  const customers = (db.customers || [])
    .map((c) => {
      const seg = segments.find((row) => row.customer.id === c.id);
      const risk = customerRisk(c);
      return {
        name: c.name,
        balance: round(Number(c.balance) || 0),
        bills: seg ? seg.frequency : 0,
        value: seg ? round(seg.monetary) : 0,
        segment: seg ? seg.segment : 'New',
        risk: risk.level,
        lastSeenDays: seg ? seg.recencyDays : null,
      };
    })
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 40);

  const suppliers = (db.suppliers || [])
    .map((x) => ({ name: x.name, balance: round(Number(x.balance) || 0) }))
    .filter((x) => x.balance > 0)
    .slice(0, 20);

  return {
    generatedAt: new Date().toISOString(),
    shop: {
      name: s.shopName || 'My Mart',
      type: s.shopType || 'mart',
      country: s.country || 'PK',
      currency: cur.symbol,
      currencyCode: cur.code,
      locale: cur.locale,
      tax: {
        system: s.taxSystem || 'GST',
        rate: Number(s.taxRate) || 0,
        number: s.taxNumber || '',
        country: s.taxCountry || 'PK',
      },
    },
    health: {
      score: health.score,
      grade: health.grade,
      sales: health.salesScore,
      profit: health.profitScore,
      stock: health.stockScore,
      credit: health.creditScore,
      expenses: health.expenseScore,
    },
    totals: {
      revenue30: round(revenue30),
      grossProfit30: round(profit30),
      expenses30: round(expenses30),
      netProfit30: round(profit30 - expenses30),
      marginPct: revenue30 ? round(((profit30 - expenses30) / revenue30) * 100, 1) : 0,
      invoices30: sales30.length,
      products: (db.products || []).length,
      customers: (db.customers || []).length,
      receivable: round(health.receivable),
      payable: round((db.suppliers || []).reduce((a, x) => a + Math.max(0, Number(x.balance) || 0), 0)),
      lowStock: health.lowCount,
    },
    today: {
      sales: round(today.totalSales),
      invoices: today.invoices,
      cash: round(today.cashSales),
      card: round(today.cardSales),
      online: round(today.onlineSales),
      credit: round(today.udhaarSales),
      expectedCash: round(today.netCash),
    },
    paymentMix: mix,
    topProducts: topProducts(sales30, 8).map((p) => ({ name: p.name, qty: p.qty, revenue: round(p.revenue) })),
    topCustomers: topCustomers(sales30, 8).map((c) => ({ name: c.name, bills: c.count, value: round(c.total) })),
    restock: plan.reorder.slice(0, 12).map((row) => ({
      name: row.product.name,
      stock: row.stock,
      sold30: row.sold,
      coverDays: row.cover == null ? null : Math.round(row.cover),
      suggested: row.suggested,
      cost: round(row.cost),
    })),
    leaks: leaks.leaks.slice(0, 10).map((l) => ({
      type: l.kind,
      issue: l.title,
      amount: round(l.amount),
      action: l.action,
    })),
    tax: {
      rate: Number(s.taxRate) || 0,
      collected30: round(tax.tax),
      taxable30: round(tax.taxable),
      invoices: tax.invoices,
    },
    forecast: {
      dailyAverage: round(forecast.averageDaily),
      predictedDaily: round(forecast.predictedDaily),
      predictedWeek: round(forecast.predictedWeek),
      trendPct: Math.round(forecast.trend * 100),
      confidence: forecast.confidence,
    },
    segments: Object.entries(
      segments.reduce((acc, row) => {
        acc[row.segment] = (acc[row.segment] || 0) + 1;
        return acc;
      }, {})
    ).map(([name, count]) => ({ name, count })),
    products,
    customers,
    suppliers,
  };
}

/** System prompt for the local model. */
export function systemPrompt(context, lang = 'ur-roman') {
  const currency = context.shop.currency || 'Rs';
  const langRule = lang === 'ur'
    ? 'Answer in Urdu script (اردو) — right to left. Keep numbers in Latin digits.'
    : lang === 'ar'
      ? 'Answer in Arabic.'
      : lang === 'en'
        ? 'Answer in English.'
        : 'Answer in Roman Urdu (the owner\'s everyday language).';
  return [
    'You are "mhzaly AI", the business intelligence assistant for a small retail shop.',
    langRule,
    '',
    'RULES:',
    '- Be short, concrete and actionable. Use tables or bullet lists, never long essays.',
    '- Always use the SHOP DATA given below. Never invent numbers. If a number is missing, say so.',
    '- Lead with the single most useful thing the owner should do today.',
    '- You may suggest actions available in the app: Smart Restock, Profit Leak Finder, Day Close, POS Billing, Reports, Customers.',
    '- Numbers are in ' + currency + '. Dates are ISO.',
    '',
    'SHOP DATA (JSON):',
    JSON.stringify(context),
  ].join('\n');
}
