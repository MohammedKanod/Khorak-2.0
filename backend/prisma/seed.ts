import bcrypt from 'bcryptjs';
import {
  AppealStatus,
  BeneficiaryCategory,
  BeneficiaryStatus,
  BatchStatus,
  DiscrepancyStatus,
  DispatchStatus,
  LedgerEventType,
  NutritionIndicator,
  ProductCategory,
  Role,
  SpoilageStatus,
  StockRequestReason,
  StockRequestStatus,
} from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { refreshAllActiveCentreAlerts } from '../src/services/alert.service';
import { formatIstDate } from '../src/lib/math';
import { computeHmacCredentialRef, generateCentreSalt } from '../src/lib/credential';

/**
 * Computes centre-salted HMAC-SHA256 protectedCredentialReference matching frontend Aadhaar Offline XML QR parser.
 */
export function computeProtectedCredentialRef(
  salt: string,
  last4: string,
  name: string,
  yob: string
): string {
  return computeHmacCredentialRef({ salt, last4, name, yob });
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function seed() {
  console.log('Seeding KHORAK Panchmahal synthetic demonstration data...');

  // Clear existing data in reverse dependency order for clean idempotent re-seeding
  await prisma.alert.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.syncOperation.deleteMany();
  await prisma.nutritionAggregate.deleteMany();
  await prisma.reconciliation.deleteMany();
  await prisma.spoilageReport.deleteMany();
  await prisma.distribution.deleteMany();
  await prisma.stockLedgerEvent.deleteMany();
  await prisma.dispatchAppealHistory.deleteMany();
  await prisma.dispatchAppeal.deleteMany();
  await prisma.discrepancyCase.deleteMany();
  await prisma.deliveryReceiptItem.deleteMany();
  await prisma.deliveryReceipt.deleteMany();
  await prisma.dispatchItem.deleteMany();
  await prisma.dispatch.deleteMany();
  await prisma.stockRequestHistory.deleteMany();
  await prisma.stockRequest.deleteMany();
  await prisma.productBatch.deleteMany();
  await prisma.product.deleteMany();
  await prisma.beneficiaryReference.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.anganwadiCentre.deleteMany();
  await prisma.sector.deleteMany();
  await prisma.block.deleteMany();
  await prisma.district.deleteMany();

  const passwordHash = await bcrypt.hash('Khorak@2026', 10);

  // 1. District
  const panchmahal = await prisma.district.create({
    data: { name: 'Panchmahal', code: 'PMH', state: 'Gujarat' },
  });

  // 2. Blocks
  const godhra = await prisma.block.create({
    data: { districtId: panchmahal.id, name: 'Godhra', code: 'PMH-GDR' },
  });
  const halol = await prisma.block.create({
    data: { districtId: panchmahal.id, name: 'Halol', code: 'PMH-HLL' },
  });
  const kalol = await prisma.block.create({
    data: { districtId: panchmahal.id, name: 'Kalol', code: 'PMH-KLL' },
  });

  // 3. Sectors
  const secGodhraUrban = await prisma.sector.create({
    data: { blockId: godhra.id, name: 'Godhra Urban-1', code: 'SEC-GDR-U1' },
  });
  const secGodhraRural = await prisma.sector.create({
    data: { blockId: godhra.id, name: 'Godhra Rural-East', code: 'SEC-GDR-RE' },
  });
  const secHalolNorth = await prisma.sector.create({
    data: { blockId: halol.id, name: 'Halol North', code: 'SEC-HLL-N1' },
  });
  const secKalolCentral = await prisma.sector.create({
    data: { blockId: kalol.id, name: 'Kalol Central', code: 'SEC-KLL-C1' },
  });

  // 4. Anganwadi Centres (each gets its own centre-scoped HMAC salt for offline QR credential hashing)
  const awcVavdi = await prisma.anganwadiCentre.create({
    data: {
      sectorId: secGodhraUrban.id,
      name: 'Vavdi Bujarg AWC-01',
      nameGu: 'વાવડી બુજર્ગ આંગણવાડી-૦૧',
      code: 'AWC-GDR-01',
      location: 'Vavdi Bujarg, Godhra, Panchmahal',
      offlineCredentialSalt: generateCentreSalt(),
    },
  });
  const awcBamroli = await prisma.anganwadiCentre.create({
    data: {
      sectorId: secGodhraUrban.id,
      name: 'Bamroli Khurd AWC-02',
      nameGu: 'બામરોલી ખુર્દ આંગણવાડી-૦૨',
      code: 'AWC-GDR-02',
      location: 'Bamroli Khurd, Godhra, Panchmahal',
      offlineCredentialSalt: generateCentreSalt(),
    },
  });
  const awcKankoda = await prisma.anganwadiCentre.create({
    data: {
      sectorId: secGodhraRural.id,
      name: 'Kankodakui AWC-03',
      nameGu: 'કાંકોડાકુઈ આંગણવાડી-૦૩',
      code: 'AWC-GDR-03',
      location: 'Kankodakui, Godhra, Panchmahal',
      offlineCredentialSalt: generateCentreSalt(),
    },
  });
  const awcHalol1 = await prisma.anganwadiCentre.create({
    data: {
      sectorId: secHalolNorth.id,
      name: 'Halol Station AWC-04',
      nameGu: 'હાલોલ સ્ટેશન આંગણવાડી-૦૪',
      code: 'AWC-HLL-01',
      location: 'Station Road, Halol, Panchmahal',
      offlineCredentialSalt: generateCentreSalt(),
    },
  });
  const awcHalol2 = await prisma.anganwadiCentre.create({
    data: {
      sectorId: secHalolNorth.id,
      name: 'Pavagadh Foothills AWC-05',
      nameGu: 'પાવાગઢ તળેટી આંગણવાડી-૦૫',
      code: 'AWC-HLL-02',
      location: 'Pavagadh Road, Halol, Panchmahal',
      offlineCredentialSalt: generateCentreSalt(),
    },
  });
  const awcKalol1 = await prisma.anganwadiCentre.create({
    data: {
      sectorId: secKalolCentral.id,
      name: 'Kalol Bazaar AWC-06',
      nameGu: 'કાલોલ બજાર આંગણવાડી-૦૬',
      code: 'AWC-KLL-01',
      location: 'Main Bazaar, Kalol, Panchmahal',
      offlineCredentialSalt: generateCentreSalt(),
    },
  });

  // 5. Suppliers
  const gcmmfl = await prisma.supplier.create({
    data: {
      name: 'GCMMFL Panchmahal Dairy & Nutrition Unit',
      code: 'GCMMFL-PMH',
      contactInformation: 'Panchamrut Dairy Campus, Godhra, Panchmahal | +91-2672-240100',
    },
  });
  const gscsc = await prisma.supplier.create({
    data: {
      name: 'Gujarat State Civil Supplies Depot (Godhra)',
      code: 'GSCSC-GDR',
      contactInformation: 'GIDC Godhra, Panchmahal | +91-2672-241220',
    },
  });

  // 6. Users across all roles
  const awwVavdi = await prisma.user.create({
    data: {
      name: 'Meenaben Parmar',
      nameGu: 'મીનાબેન પરમાર',
      username: 'aww.vavdi',
      email: 'aww.vavdi@khorak.demo',
      passwordHash,
      role: Role.AWW,
      centreId: awcVavdi.id,
      sectorId: secGodhraUrban.id,
      blockId: godhra.id,
      districtId: panchmahal.id,
    },
  });

  await prisma.user.create({
    data: {
      name: 'Kavitaben Chauhan',
      nameGu: 'કવિતાબેન ચૌહાણ',
      username: 'aww.bamroli',
      email: 'aww.bamroli@khorak.demo',
      passwordHash,
      role: Role.AWW,
      centreId: awcBamroli.id,
      sectorId: secGodhraUrban.id,
      blockId: godhra.id,
      districtId: panchmahal.id,
    },
  });

  await prisma.user.create({
    data: {
      name: 'Ramilaben Rathod',
      nameGu: 'રમીલાબેન રાઠોડ',
      username: 'awh.vavdi',
      email: 'awh.vavdi@khorak.demo',
      passwordHash,
      role: Role.AWH,
      centreId: awcVavdi.id,
      sectorId: secGodhraUrban.id,
      blockId: godhra.id,
      districtId: panchmahal.id,
    },
  });

  const supplierUser = await prisma.user.create({
    data: {
      name: 'Rajeshbhai Patel (GCMMFL)',
      nameGu: 'રાજેશભાઈ પટેલ',
      username: 'supplier.gcmmfl',
      email: 'supplier.gcmmfl@khorak.demo',
      passwordHash,
      role: Role.SUPPLIER,
      supplierId: gcmmfl.id,
    },
  });

  const supervisorUser = await prisma.user.create({
    data: {
      name: 'Hetalben Solanki (Mukhya Sevika)',
      nameGu: 'હેતલબેન સોલંકી',
      username: 'sup.godhra',
      email: 'sup.godhra@khorak.demo',
      passwordHash,
      role: Role.SUPERVISOR,
      sectorId: secGodhraUrban.id,
      blockId: godhra.id,
      districtId: panchmahal.id,
    },
  });

  await prisma.user.create({
    data: {
      name: 'Dr. Nirav Desai (CDPO)',
      nameGu: 'ડૉ. નીરવ દેસાઈ',
      username: 'cdpo.godhra',
      email: 'cdpo.godhra@khorak.demo',
      passwordHash,
      role: Role.CDPO,
      blockId: godhra.id,
      districtId: panchmahal.id,
    },
  });

  await prisma.user.create({
    data: {
      name: 'Prakashbhai Bariya (TDO)',
      nameGu: 'પ્રકાશભાઈ બારિયા',
      username: 'tdo.godhra',
      email: 'tdo.godhra@khorak.demo',
      passwordHash,
      role: Role.TDO,
      blockId: godhra.id,
      districtId: panchmahal.id,
    },
  });

  await prisma.user.create({
    data: {
      name: 'Smt. Bhavnaben Mehta (DPO)',
      nameGu: 'ભાવનાબેન મહેતા',
      username: 'dpo.panchmahal',
      email: 'dpo.panchmahal@khorak.demo',
      passwordHash,
      role: Role.DPO,
      districtId: panchmahal.id,
    },
  });

  await prisma.user.create({
    data: {
      name: 'Shri K. M. Prajapati (DDO)',
      nameGu: 'કે. એમ. પ્રજાપતિ',
      username: 'ddo.panchmahal',
      email: 'ddo.panchmahal@khorak.demo',
      passwordHash,
      role: Role.DDO,
      districtId: panchmahal.id,
    },
  });

  // 7. Products (THR & HCM)
  const balShakti = await prisma.product.create({
    data: {
      code: 'THR-BAL',
      name: 'Bal Shakti (500g Pkt)',
      nameGu: 'બાળ શક્તિ (૫૦૦ ગ્રામ)',
      category: ProductCategory.THR,
      unit: 'packets',
      defaultDailyRate: 8,
    },
  });
  const matruShakti = await prisma.product.create({
    data: {
      code: 'THR-MAT',
      name: 'Matru Shakti (1kg Pkt)',
      nameGu: 'માતૃ શક્તિ (૧ કિગ્રા)',
      category: ProductCategory.THR,
      unit: 'packets',
      defaultDailyRate: 5,
    },
  });
  const purnaShakti = await prisma.product.create({
    data: {
      code: 'THR-PUR',
      name: 'Purna Shakti (1kg Pkt)',
      nameGu: 'પૂર્ણ શક્તિ (૧ કિગ્રા)',
      category: ProductCategory.THR,
      unit: 'packets',
      defaultDailyRate: 4,
    },
  });
  const rice = await prisma.product.create({
    data: {
      code: 'HCM-RICE',
      name: 'Fortified Rice',
      nameGu: 'ફોર્ટિફાઇડ ચોખા',
      category: ProductCategory.HCM,
      unit: 'kg',
      defaultDailyRate: 4,
    },
  });
  const toorDal = await prisma.product.create({
    data: {
      code: 'HCM-DAL',
      name: 'Toor Dal',
      nameGu: 'તુવેર દાળ',
      category: ProductCategory.HCM,
      unit: 'kg',
      defaultDailyRate: 2,
    },
  });
  const oil = await prisma.product.create({
    data: {
      code: 'HCM-OIL',
      name: 'Fortified Groundnut Oil',
      nameGu: 'સીંગતેલ',
      category: ProductCategory.HCM,
      unit: 'litres',
      defaultDailyRate: 0.8,
    },
  });

  // 8. Batches
  const batchBalFresh = await prisma.productBatch.create({
    data: {
      productId: balShakti.id,
      batchNumber: 'BAL-2026-NOV01',
      supplierId: gcmmfl.id,
      manufacturingDate: daysFromNow(-20),
      expiryDate: daysFromNow(120),
      status: BatchStatus.ACTIVE,
    },
  });
  const batchBalExpiringSoon = await prisma.productBatch.create({
    data: {
      productId: balShakti.id,
      batchNumber: 'BAL-2026-OCT14',
      supplierId: gcmmfl.id,
      manufacturingDate: daysFromNow(-165),
      expiryDate: daysFromNow(12),
      status: BatchStatus.ACTIVE,
    },
  });
  const batchBalExpired = await prisma.productBatch.create({
    data: {
      productId: balShakti.id,
      batchNumber: 'BAL-2026-MAY02',
      supplierId: gcmmfl.id,
      manufacturingDate: daysFromNow(-200),
      expiryDate: daysFromNow(-10),
      status: BatchStatus.EXPIRED,
    },
  });
  const batchMatActive = await prisma.productBatch.create({
    data: {
      productId: matruShakti.id,
      batchNumber: 'MAT-2026-NOV05',
      supplierId: gcmmfl.id,
      manufacturingDate: daysFromNow(-15),
      expiryDate: daysFromNow(95),
      status: BatchStatus.ACTIVE,
    },
  });
  const batchPurActive = await prisma.productBatch.create({
    data: {
      productId: purnaShakti.id,
      batchNumber: 'PUR-2026-NOV03',
      supplierId: gcmmfl.id,
      manufacturingDate: daysFromNow(-18),
      expiryDate: daysFromNow(80),
      status: BatchStatus.ACTIVE,
    },
  });
  const batchRiceActive = await prisma.productBatch.create({
    data: {
      productId: rice.id,
      batchNumber: 'RIC-2026-OCT22',
      supplierId: gscsc.id,
      manufacturingDate: daysFromNow(-30),
      expiryDate: daysFromNow(210),
      status: BatchStatus.ACTIVE,
    },
  });
  const batchDalActive = await prisma.productBatch.create({
    data: {
      productId: toorDal.id,
      batchNumber: 'DAL-2026-NOV01',
      supplierId: gscsc.id,
      manufacturingDate: daysFromNow(-22),
      expiryDate: daysFromNow(180),
      status: BatchStatus.ACTIVE,
    },
  });
  const batchOilActive = await prisma.productBatch.create({
    data: {
      productId: oil.id,
      batchNumber: 'OIL-2026-NOV04',
      supplierId: gscsc.id,
      manufacturingDate: daysFromNow(-14),
      expiryDate: daysFromNow(240),
      status: BatchStatus.ACTIVE,
    },
  });

  // 9. Synthetic Beneficiary References (ZERO raw or masked Aadhaar digits stored)
  const centreSalts: Record<string, string> = {
    [awcVavdi.id]: awcVavdi.offlineCredentialSalt || '',
    [awcBamroli.id]: awcBamroli.offlineCredentialSalt || '',
  };

  const syntheticBeneficiaries = [
    {
      centreId: awcVavdi.id,
      localReference: 'BEN-GDR01-001',
      displayName: 'Poojaben Maheshbhai Bariya',
      displayNameGu: 'પૂજાબેન મહેશભાઈ બારિયા',
      syntheticLast4: '4821',
      yob: '1997',
      category: BeneficiaryCategory.PREGNANT_WOMAN,
    },
    {
      centreId: awcVavdi.id,
      localReference: 'BEN-GDR01-002',
      displayName: 'Aarav Sureshbhai Parmar',
      displayNameGu: 'આરવ સુરેશભાઈ પરમાર',
      syntheticLast4: '7394',
      yob: '2024',
      category: BeneficiaryCategory.CHILD_6M_3Y,
    },
    {
      centreId: awcVavdi.id,
      localReference: 'BEN-GDR01-003',
      displayName: 'Kajalben Rameshbhai Nayak',
      displayNameGu: 'કાજલબેન રમેશભાઈ નાયક',
      syntheticLast4: '1508',
      yob: '1999',
      category: BeneficiaryCategory.LACTATING_MOTHER,
    },
    {
      centreId: awcVavdi.id,
      localReference: 'BEN-GDR01-004',
      displayName: 'Diyaben Kiranbhai Rathwa',
      displayNameGu: 'દિયાબેન કિરણભાઈ રાઠવા',
      syntheticLast4: '9260',
      yob: '2011',
      category: BeneficiaryCategory.ADOLESCENT_GIRL,
    },
    {
      centreId: awcBamroli.id,
      localReference: 'BEN-GDR02-001',
      displayName: 'Nandini Rajeshbhai Patel',
      displayNameGu: 'નંદિની રાજેશભાઈ પટેલ',
      syntheticLast4: '3147',
      yob: '2023',
      category: BeneficiaryCategory.CHILD_3Y_6Y,
    },
  ];

  const createdBeneficiaries = [];
  for (const b of syntheticBeneficiaries) {
    const row = await prisma.beneficiaryReference.create({
      data: {
        centreId: b.centreId,
        localReference: b.localReference,
        displayName: b.displayName,
        displayNameGu: b.displayNameGu,
        maskedIdLast4: null,
        yob: b.yob,
        beneficiaryCategory: b.category,
        status: BeneficiaryStatus.APPROVED,
        reviewedBy: supervisorUser.id,
        reviewedAt: daysFromNow(-5),
        reviewRemarks: 'Verified during initial centre setup',
        protectedCredentialReference: computeProtectedCredentialRef(
          centreSalts[b.centreId],
          b.syntheticLast4,
          b.displayName,
          b.yob
        ),
      },
    });
    createdBeneficiaries.push(row);
  }

  // One pending beneficiary request awaiting Mukhya Sevika approval in demo
  await prisma.beneficiaryReference.create({
    data: {
      centreId: awcVavdi.id,
      localReference: 'BEN-GDR01-005',
      displayName: 'Sonalben Vijaybhai Gohil',
      displayNameGu: 'સોનલબેન વિજયભાઈ ગોહિલ',
      maskedIdLast4: null,
      yob: '2001',
      beneficiaryCategory: BeneficiaryCategory.PREGNANT_WOMAN,
      status: BeneficiaryStatus.PENDING_APPROVAL,
      requestedBy: awwVavdi.id,
      protectedCredentialReference: computeProtectedCredentialRef(
        awcVavdi.offlineCredentialSalt || '',
        '6429',
        'Sonalben Vijaybhai Gohil',
        '2001'
      ),
    },
  });

  // 10. Stock Ledger Events across centres (creating realistic reorder warning/critical/stockout & FEFO states)
  // For AWC Vavdi:
  // - Bal Shakti: 25 pkt in Expiring Soon batch + 55 pkt in Fresh batch + 6 pkt in Expired batch (usable = 80)
  // - Matru Shakti: 40 pkt opening, plus 5 days of 8/day? Let's make Matru Shakti usable = 25 pkt (5 days at 5/day -> WARNING)
  // - Purna Shakti: 8 pkt usable (2 days at 4/day -> CRITICAL)
  // - Rice: 32 kg, Dal: 14 kg, Oil: 0 litres (STOCKOUT)
  const ledgerSeed: Array<{
    centreId: string;
    productId: string;
    batchId: string;
    eventType: LedgerEventType;
    quantity: number;
    key: string;
    daysAgo?: number;
    remarks?: string;
  }> = [
    // Vavdi AWC-01
    { centreId: awcVavdi.id, productId: balShakti.id, batchId: batchBalExpiringSoon.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 25, key: 'seed-vav-bal-exp-soon', daysAgo: 10, remarks: 'Opening stock (FEFO priority)' },
    { centreId: awcVavdi.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 95, key: 'seed-vav-bal-fresh', daysAgo: 10, remarks: 'Opening stock' },
    { centreId: awcVavdi.id, productId: balShakti.id, batchId: batchBalExpired.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 6, key: 'seed-vav-bal-expired', daysAgo: 30, remarks: 'Older stock (now expired)' },
    // 5 days of 8/day consumption on fresh batch -> remaining 55 + 25 = 80 usable (10 days)
    { centreId: awcVavdi.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 8, key: 'seed-vav-bal-d1', daysAgo: 5 },
    { centreId: awcVavdi.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 8, key: 'seed-vav-bal-d2', daysAgo: 4 },
    { centreId: awcVavdi.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 8, key: 'seed-vav-bal-d3', daysAgo: 3 },
    { centreId: awcVavdi.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 8, key: 'seed-vav-bal-d4', daysAgo: 2 },
    { centreId: awcVavdi.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 8, key: 'seed-vav-bal-d5', daysAgo: 1 },

    // Matru Shakti at Vavdi: 25 pkt remaining at 5/day = 5 days -> REORDER_WARNING
    { centreId: awcVavdi.id, productId: matruShakti.id, batchId: batchMatActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 45, key: 'seed-vav-mat-open', daysAgo: 8 },
    { centreId: awcVavdi.id, productId: matruShakti.id, batchId: batchMatActive.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 5, key: 'seed-vav-mat-d1', daysAgo: 4 },
    { centreId: awcVavdi.id, productId: matruShakti.id, batchId: batchMatActive.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 5, key: 'seed-vav-mat-d2', daysAgo: 3 },
    { centreId: awcVavdi.id, productId: matruShakti.id, batchId: batchMatActive.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 5, key: 'seed-vav-mat-d3', daysAgo: 2 },
    { centreId: awcVavdi.id, productId: matruShakti.id, batchId: batchMatActive.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 5, key: 'seed-vav-mat-d4', daysAgo: 1 },

    // Purna Shakti at Vavdi: 8 pkt remaining at 4/day = 2 days -> REORDER_CRITICAL
    { centreId: awcVavdi.id, productId: purnaShakti.id, batchId: batchPurActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 20, key: 'seed-vav-pur-open', daysAgo: 6 },
    { centreId: awcVavdi.id, productId: purnaShakti.id, batchId: batchPurActive.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 4, key: 'seed-vav-pur-d1', daysAgo: 3 },
    { centreId: awcVavdi.id, productId: purnaShakti.id, batchId: batchPurActive.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 4, key: 'seed-vav-pur-d2', daysAgo: 2 },
    { centreId: awcVavdi.id, productId: purnaShakti.id, batchId: batchPurActive.id, eventType: LedgerEventType.DISTRIBUTED, quantity: 4, key: 'seed-vav-pur-d3', daysAgo: 1 },

    // HCM at Vavdi
    { centreId: awcVavdi.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 48, key: 'seed-vav-ric-open', daysAgo: 6 },
    { centreId: awcVavdi.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.CONSUMED, quantity: 4, key: 'seed-vav-ric-c1', daysAgo: 4 },
    { centreId: awcVavdi.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.CONSUMED, quantity: 4, key: 'seed-vav-ric-c2', daysAgo: 3 },
    { centreId: awcVavdi.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.CONSUMED, quantity: 4, key: 'seed-vav-ric-c3', daysAgo: 2 },
    { centreId: awcVavdi.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.CONSUMED, quantity: 4, key: 'seed-vav-ric-c4', daysAgo: 1 },
    { centreId: awcVavdi.id, productId: toorDal.id, batchId: batchDalActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 18, key: 'seed-vav-dal-open', daysAgo: 5 },
    { centreId: awcVavdi.id, productId: toorDal.id, batchId: batchDalActive.id, eventType: LedgerEventType.CONSUMED, quantity: 4, key: 'seed-vav-dal-c1', daysAgo: 2 },

    // Bamroli AWC-02
    { centreId: awcBamroli.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 40, key: 'seed-bam-bal-open', daysAgo: 7 },
    { centreId: awcBamroli.id, productId: matruShakti.id, batchId: batchMatActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 30, key: 'seed-bam-mat-open', daysAgo: 7 },
    { centreId: awcBamroli.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 35, key: 'seed-bam-ric-open', daysAgo: 7 },

    // Other centres across blocks
    { centreId: awcKankoda.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 90, key: 'seed-kan-bal-open', daysAgo: 6 },
    { centreId: awcKankoda.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 50, key: 'seed-kan-ric-open', daysAgo: 6 },
    { centreId: awcHalol1.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 110, key: 'seed-hl1-bal-open', daysAgo: 5 },
    { centreId: awcHalol1.id, productId: matruShakti.id, batchId: batchMatActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 60, key: 'seed-hl1-mat-open', daysAgo: 5 },
    { centreId: awcHalol1.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 55, key: 'seed-hl1-ric-open', daysAgo: 5 },
    { centreId: awcHalol2.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 24, key: 'seed-hl2-bal-open', daysAgo: 5 },
    { centreId: awcKalol1.id, productId: balShakti.id, batchId: batchBalFresh.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 85, key: 'seed-kl1-bal-open', daysAgo: 5 },
    { centreId: awcKalol1.id, productId: matruShakti.id, batchId: batchMatActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 45, key: 'seed-kl1-mat-open', daysAgo: 5 },
    { centreId: awcKalol1.id, productId: rice.id, batchId: batchRiceActive.id, eventType: LedgerEventType.OPENING_STOCK, quantity: 40, key: 'seed-kl1-ric-open', daysAgo: 5 },
  ];

  for (const ev of ledgerSeed) {
    await prisma.stockLedgerEvent.create({
      data: {
        centreId: ev.centreId,
        productId: ev.productId,
        batchId: ev.batchId,
        eventType: ev.eventType,
        quantity: ev.quantity,
        referenceType: 'DEMO_SEED',
        remarks: ev.remarks ?? 'Synthetic demonstration history',
        idempotencyKey: ev.key,
        createdBy: awwVavdi.id,
        createdAt: ev.daysAgo ? daysFromNow(-ev.daysAgo) : new Date(),
      },
    });
  }

  // 11. Sample historical distribution (yesterday, so today's beneficiaries are free to distribute in demo!)
  const yesterday = daysFromNow(-1);
  await prisma.distribution.create({
    data: {
      centreId: awcVavdi.id,
      beneficiaryReferenceId: createdBeneficiaries[1].id,
      productId: balShakti.id,
      batchId: batchBalFresh.id,
      quantity: 2,
      distributedBy: awwVavdi.id,
      distributedAt: yesterday,
      distributionDay: formatIstDate(yesterday),
      idempotencyKey: 'seed-dist-yesterday-001',
      remarks: 'Regular THR handout (demo seed)',
    },
  });

  // 12. Pending Dispatch (awaiting AWW receipt at Vavdi AWC-01) & Discrepancy Dispatch (at Bamroli AWC-02)
  await prisma.dispatch.create({
    data: {
      supplierId: gcmmfl.id,
      destinationCentreId: awcVavdi.id,
      dispatchReference: 'DSP-GDR01-2026-DEMO01',
      status: DispatchStatus.DISPATCHED,
      dispatchDate: daysFromNow(-1),
      notes: 'Monthly THR replenishment consignment — ready for AWW verification',
      createdBy: supplierUser.id,
      items: {
        create: [
          {
            productId: balShakti.id,
            batchId: batchBalFresh.id,
            expectedQuantity: 100,
          },
          {
            productId: matruShakti.id,
            batchId: batchMatActive.id,
            expectedQuantity: 50,
          },
        ],
      },
    },
  });

  const discDispatch = await prisma.dispatch.create({
    data: {
      supplierId: gcmmfl.id,
      destinationCentreId: awcBamroli.id,
      dispatchReference: 'DSP-GDR02-2026-DEMO02',
      status: DispatchStatus.DISCREPANCY,
      dispatchDate: daysFromNow(-3),
      notes: 'Consignment received with transit shortage',
      createdBy: supplierUser.id,
      items: {
        create: [
          {
            productId: balShakti.id,
            batchId: batchBalFresh.id,
            expectedQuantity: 60,
          },
        ],
      },
    },
  });

  const discReceipt = await prisma.deliveryReceipt.create({
    data: {
      dispatchId: discDispatch.id,
      expectedQuantity: 60,
      acceptedQuantity: 52,
      damagedQuantity: 3,
      missingQuantity: 5,
      notes: '3 packets torn in transit, 5 packets missing from sealed crate',
      receivedBy: awwVavdi.id,
      receivedAt: daysFromNow(-2),
      idempotencyKey: 'seed-dlv-bamroli-001',
      items: {
        create: [
          {
            productId: balShakti.id,
            batchId: batchBalFresh.id,
            expectedQuantity: 60,
            acceptedQuantity: 52,
            damagedQuantity: 3,
            missingQuantity: 5,
          },
        ],
      },
    },
  });

  const discCase = await prisma.discrepancyCase.create({
    data: {
      dispatchId: discDispatch.id,
      deliveryReceiptId: discReceipt.id,
      expectedQuantity: 60,
      actualQuantity: 52,
      damagedQuantity: 3,
      missingQuantity: 5,
      difference: 8,
      status: DiscrepancyStatus.OPEN,
    },
  });

  // 12b. Connected Demo Dispatch Appeal & Stock Requests
  await prisma.dispatchAppeal.create({
    data: {
      appealReference: 'APL-AWC-GDR-02-DEMO01',
      dispatchId: discDispatch.id,
      discrepancyCaseId: discCase.id,
      supplierId: gcmmfl.id,
      centreId: awcBamroli.id,
      productId: balShakti.id,
      batchId: batchBalFresh.id,
      dispatchedQuantity: 60,
      receivedQuantity: 52,
      damagedQuantity: 3,
      missingQuantity: 5,
      supervisorRemarks: '3 packets torn in transit and 5 packets missing from sealed crate upon AWC verification. Requesting supplier explanation and credit/replacement batch.',
      status: AppealStatus.AWAITING_SUPPLIER_RESPONSE,
      createdBy: supervisorUser.id,
      history: {
        create: [
          {
            actorId: supervisorUser.id,
            fromStatus: null,
            toStatus: AppealStatus.AWAITING_SUPPLIER_RESPONSE,
            action: 'SUBMITTED_TO_SUPPLIER',
            remarks: 'Discrepancy appeal raised to GCMMFL supplier',
          },
        ],
      },
    },
  });

  await prisma.stockRequest.create({
    data: {
      requestNumber: 'REQ-AWC-GDR-01-DEMO1',
      centreId: awcVavdi.id,
      productId: purnaShakti.id,
      requestedQuantity: 40,
      reason: StockRequestReason.LOW_STOCK,
      remarks: 'Stock down to critical 2-day cover for adolescent girls',
      status: StockRequestStatus.PENDING_APPROVAL,
      requestedBy: awwVavdi.id,
      idempotencyKey: 'seed-stock-req-001',
      history: {
        create: {
          actorId: awwVavdi.id,
          fromStatus: null,
          toStatus: StockRequestStatus.PENDING_APPROVAL,
          action: 'SUBMITTED',
          remarks: 'Initial urgent replenishment request from Vavdi AWC-01',
        },
      },
    },
  });

  await prisma.stockRequest.create({
    data: {
      requestNumber: 'REQ-AWC-GDR-01-DEMO2',
      centreId: awcVavdi.id,
      productId: oil.id,
      requestedQuantity: 20,
      approvedQuantity: 15,
      reason: StockRequestReason.LOW_STOCK,
      remarks: 'Zero stock on shelf for Hot Cooked Meal preparation',
      reviewRemarks: 'Approved 15 litres based on block allocation; ready for supplier dispatch',
      status: StockRequestStatus.APPROVED,
      requestedBy: awwVavdi.id,
      reviewedBy: supervisorUser.id,
      reviewedAt: daysFromNow(-1),
      idempotencyKey: 'seed-stock-req-002',
      history: {
        create: [
          {
            actorId: awwVavdi.id,
            fromStatus: null,
            toStatus: StockRequestStatus.PENDING_APPROVAL,
            action: 'SUBMITTED',
            remarks: 'Urgent oil stockout request',
          },
          {
            actorId: supervisorUser.id,
            fromStatus: StockRequestStatus.PENDING_APPROVAL,
            toStatus: StockRequestStatus.APPROVED,
            action: 'PARTIAL_APPROVE',
            remarks: 'Approved 15 litres for immediate supplier dispatch',
          },
        ],
      },
    },
  });

  // 13. Pending Spoilage Report & Pending Reconciliation for Supervisor review queue
  await prisma.spoilageReport.create({
    data: {
      centreId: awcVavdi.id,
      productId: toorDal.id,
      batchId: batchDalActive.id,
      quantity: 1.5,
      reason: 'Moisture damage during monsoon storage',
      remarks: 'Outer sack dampened near store corner',
      status: SpoilageStatus.PENDING,
      reportedBy: awwVavdi.id,
      idempotencyKey: 'seed-spoil-vavdi-001',
    },
  });

  await prisma.reconciliation.create({
    data: {
      centreId: awcBamroli.id,
      productId: matruShakti.id,
      batchId: batchMatActive.id,
      calculatedStock: 30,
      physicalStock: 28,
      variance: -2,
      remarks: 'Physical shelf count showed 28 packets vs 30 in ledger',
      verifiedBy: supervisorUser.id,
    },
  });

  // 14. Synthetic Aggregate Nutrition Indicators (clearly labelled demo data)
  const periods = ['2026-Q1', '2026-Q2', '2026-Q3'];
  const nutritionSeed: Array<{
    blockId: string;
    period: string;
    indicator: NutritionIndicator;
    value: number;
  }> = [
    { blockId: godhra.id, period: periods[0], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 21.4 },
    { blockId: godhra.id, period: periods[1], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 20.1 },
    { blockId: godhra.id, period: periods[2], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 18.9 },
    { blockId: godhra.id, period: periods[0], indicator: NutritionIndicator.WASTING_PCT, value: 11.8 },
    { blockId: godhra.id, period: periods[1], indicator: NutritionIndicator.WASTING_PCT, value: 10.9 },
    { blockId: godhra.id, period: periods[2], indicator: NutritionIndicator.WASTING_PCT, value: 10.2 },
    { blockId: godhra.id, period: periods[0], indicator: NutritionIndicator.SAM_PCT, value: 3.1 },
    { blockId: godhra.id, period: periods[1], indicator: NutritionIndicator.SAM_PCT, value: 2.8 },
    { blockId: godhra.id, period: periods[2], indicator: NutritionIndicator.SAM_PCT, value: 2.4 },

    { blockId: halol.id, period: periods[0], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 18.2 },
    { blockId: halol.id, period: periods[1], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 17.5 },
    { blockId: halol.id, period: periods[2], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 16.4 },
    { blockId: halol.id, period: periods[0], indicator: NutritionIndicator.WASTING_PCT, value: 9.8 },
    { blockId: halol.id, period: periods[1], indicator: NutritionIndicator.WASTING_PCT, value: 9.1 },
    { blockId: halol.id, period: periods[2], indicator: NutritionIndicator.WASTING_PCT, value: 8.6 },
    { blockId: halol.id, period: periods[0], indicator: NutritionIndicator.SAM_PCT, value: 2.3 },
    { blockId: halol.id, period: periods[1], indicator: NutritionIndicator.SAM_PCT, value: 2.1 },
    { blockId: halol.id, period: periods[2], indicator: NutritionIndicator.SAM_PCT, value: 1.8 },

    { blockId: kalol.id, period: periods[0], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 22.8 },
    { blockId: kalol.id, period: periods[1], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 21.3 },
    { blockId: kalol.id, period: periods[2], indicator: NutritionIndicator.UNDERWEIGHT_PCT, value: 19.7 },
    { blockId: kalol.id, period: periods[0], indicator: NutritionIndicator.WASTING_PCT, value: 12.4 },
    { blockId: kalol.id, period: periods[1], indicator: NutritionIndicator.WASTING_PCT, value: 11.5 },
    { blockId: kalol.id, period: periods[2], indicator: NutritionIndicator.WASTING_PCT, value: 10.6 },
    { blockId: kalol.id, period: periods[0], indicator: NutritionIndicator.SAM_PCT, value: 3.4 },
    { blockId: kalol.id, period: periods[1], indicator: NutritionIndicator.SAM_PCT, value: 3.0 },
    { blockId: kalol.id, period: periods[2], indicator: NutritionIndicator.SAM_PCT, value: 2.6 },
  ];

  await prisma.nutritionAggregate.createMany({
    data: nutritionSeed.map((n) => ({
      blockId: n.blockId,
      reportingPeriod: n.period,
      indicator: n.indicator,
      value: n.value,
      source: 'SYNTHETIC_DEMO_POSHAN_SUMMARY',
      isSyntheticDemo: true,
    })),
  });

  // 15. Generate initial alerts for all centres
  await refreshAllActiveCentreAlerts();

  console.log('Seed completed successfully!');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

