/* ============================================================
   mhzaly — receipt helpers
   ============================================================ */

export function formatReceipt({ shop, settings, sale }) {
  const lines = [];
  lines.push('========================================');
  lines.push(`  ${esc(settings.shopName || shop.name || 'My Shop')}`);
  if (settings.phone) lines.push(`  Phone: ${esc(settings.phone)}`);
  lines.push(`  Code: ${esc(shop.code || '')}`);
  lines.push('----------------------------------------');
  lines.push(`  Invoice: ${esc(sale.invoiceNo || sale.id)}`);
  lines.push(`  Date: ${new Date(sale.createdAt).toLocaleString()}`);
  lines.push('----------------------------------------');
  for (const item of sale.items || []) {
    lines.push(`  ${esc(item.name)}`);
    lines.push(`    ${item.qty} x Rs ${Number(item.price).toLocaleString()} = Rs ${Number(item.total || item.qty * item.price).toLocaleString()}`);
  }
  lines.push('----------------------------------------');
  lines.push(`  Total: Rs ${Number(sale.total).toLocaleString()}`);
  lines.push(`  Payment: ${esc(sale.paymentMethod || 'Cash')}`);
  lines.push('========================================');
  lines.push('  Thank you for shopping with us!');
  lines.push('========================================');
  return lines.join('\n');
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
