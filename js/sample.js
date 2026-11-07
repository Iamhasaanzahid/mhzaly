/* ============================================================
   mhzaly — sample/demo data
   ============================================================ */

import { db, save, uid } from '../db.js';

export function loadSampleData() {
  const now = new Date().toISOString();
  const products = [
    { name: 'Daal Chana (500g)', category: 'Grocery', unit: 'pack', cost: 145, price: 180, lowStock: 10, sku: '1001', stock: 25 },
    { name: 'Basmati Rice 1kg', category: 'Grocery', unit: 'kg', cost: 230, price: 280, lowStock: 10, sku: '1002', stock: 12 },
    { name: 'Cooking Oil 1L', category: 'Grocery', unit: 'ltr', cost: 420, price: 490, lowStock: 10, sku: '1003', stock: 8 },
    { name: 'USB Charger 10W', category: 'Chargers', unit: 'pcs', cost: 350, price: 500, lowStock: 5, sku: '2001', stock: 15 },
    { name: 'Type-C Cable', category: 'Cables', unit: 'pcs', cost: 200, price: 300, lowStock: 10, sku: '2003', stock: 30 },
  ];
  db.products = products.map((p) => ({ id: uid('prd'), ...p, createdAt: now, updatedAt: now }));
  db.sales = [
    { id: uid('sale'), invoiceNo: 'INV-000001', customerName: 'Ali Khan', items: [], total: 480, paymentMethod: 'Cash', createdAt: now },
    { id: uid('sale'), invoiceNo: 'INV-000002', customerName: 'Sara Ahmed', items: [], total: 790, paymentMethod: 'Cash', createdAt: now },
  ];
  save();
}
