import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';

function sqlVal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (typeof v === 'object') {
    const json = JSON.stringify(v).replace(/'/g, "''");
    return `'${json}'::jsonb`;
  }
  const str = String(v).replace(/'/g, "''");
  return `'${str}'`;
}

function buildInserts(table: string, rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return `-- ${table}: 0 rows\n`;
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const lines = rows.map((row) => {
    const vals = cols.map((c) => sqlVal(row[c])).join(', ');
    return `INSERT INTO "${table}" (${colList}) VALUES (${vals});`;
  });
  return `-- ${table} (${rows.length} rows)\n${lines.join('\n')}\n\n`;
}

async function main() {
  const tablesInOrder: Array<[string, Array<Record<string, unknown>>]> = [
    ['District', (await prisma.district.findMany()) as unknown as Array<Record<string, unknown>>],
    ['Block', (await prisma.block.findMany()) as unknown as Array<Record<string, unknown>>],
    ['Sector', (await prisma.sector.findMany()) as unknown as Array<Record<string, unknown>>],
    ['AnganwadiCentre', (await prisma.anganwadiCentre.findMany()) as unknown as Array<Record<string, unknown>>],
    ['Supplier', (await prisma.supplier.findMany()) as unknown as Array<Record<string, unknown>>],
    ['User', (await prisma.user.findMany()) as unknown as Array<Record<string, unknown>>],
    ['Product', (await prisma.product.findMany()) as unknown as Array<Record<string, unknown>>],
    ['EntitlementRule', (await prisma.entitlementRule.findMany()) as unknown as Array<Record<string, unknown>>],
    ['ProductBatch', (await prisma.productBatch.findMany()) as unknown as Array<Record<string, unknown>>],
    ['BeneficiaryReference', (await prisma.beneficiaryReference.findMany()) as unknown as Array<Record<string, unknown>>],
    ['StockRequest', (await prisma.stockRequest.findMany()) as unknown as Array<Record<string, unknown>>],
    ['StockRequestHistory', (await prisma.stockRequestHistory.findMany()) as unknown as Array<Record<string, unknown>>],
    ['Dispatch', (await prisma.dispatch.findMany()) as unknown as Array<Record<string, unknown>>],
    ['DispatchItem', (await prisma.dispatchItem.findMany()) as unknown as Array<Record<string, unknown>>],
    ['DeliveryReceipt', (await prisma.deliveryReceipt.findMany()) as unknown as Array<Record<string, unknown>>],
    ['DeliveryReceiptItem', (await prisma.deliveryReceiptItem.findMany()) as unknown as Array<Record<string, unknown>>],
    ['DiscrepancyCase', (await prisma.discrepancyCase.findMany()) as unknown as Array<Record<string, unknown>>],
    ['DispatchAppeal', (await prisma.dispatchAppeal.findMany()) as unknown as Array<Record<string, unknown>>],
    ['DispatchAppealHistory', (await prisma.dispatchAppealHistory.findMany()) as unknown as Array<Record<string, unknown>>],
    ['StockLedgerEvent', (await prisma.stockLedgerEvent.findMany()) as unknown as Array<Record<string, unknown>>],
    ['Distribution', (await prisma.distribution.findMany()) as unknown as Array<Record<string, unknown>>],
    ['SpoilageReport', (await prisma.spoilageReport.findMany()) as unknown as Array<Record<string, unknown>>],
    ['Reconciliation', (await prisma.reconciliation.findMany()) as unknown as Array<Record<string, unknown>>],
    ['NutritionAggregate', (await prisma.nutritionAggregate.findMany()) as unknown as Array<Record<string, unknown>>],
    ['Alert', (await prisma.alert.findMany()) as unknown as Array<Record<string, unknown>>],
  ];

  let sql = `-- KHORAK (ખોરાક) Synthetic Panchmahal Demonstration Seed SQL\n`;
  sql += `-- Paste into Supabase SQL Editor AFTER running the Prisma migration SQL files.\n\n`;
  sql += `BEGIN;\n\n`;
  sql += `TRUNCATE TABLE "Alert", "Approval", "AuditLog", "SyncOperation", "NutritionAggregate", "Reconciliation", "SpoilageReport", "Distribution", "StockLedgerEvent", "DispatchAppealHistory", "DispatchAppeal", "DiscrepancyCase", "DeliveryReceiptItem", "DeliveryReceipt", "DispatchItem", "Dispatch", "StockRequestHistory", "StockRequest", "ProductBatch", "EntitlementRule", "Product", "BeneficiaryReference", "RefreshToken", "User", "Supplier", "AnganwadiCentre", "Sector", "Block", "District" CASCADE;\n\n`;

  for (const [table, rows] of tablesInOrder) {
    sql += buildInserts(table, rows);
  }

  sql += `COMMIT;\n`;

  const outPath = path.resolve(process.cwd(), 'prisma/seed.sql');
  fs.writeFileSync(outPath, sql, 'utf8');
  console.log(`Exported ${outPath} (${Buffer.byteLength(sql, 'utf8')} bytes).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

