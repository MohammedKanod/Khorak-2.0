export type Role =
  | 'GUARDIAN'
  | 'AWW'
  | 'AWH'
  | 'SUPPLIER'
  | 'SUPERVISOR'
  | 'CDPO'
  | 'DPO'
  | 'TDO'
  | 'DDO';

export type ProductCategory = 'THR' | 'HCM';
export type ReorderLevel = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'STOCKOUT';
export type BatchStatus = 'ACTIVE' | 'QUARANTINED' | 'EXPIRED' | 'DAMAGED';
export type DispatchStatus = 'DRAFT' | 'DISPATCHED' | 'DELIVERED' | 'DISCREPANCY' | 'CANCELLED';
export type OutboxStatus = 'saved_locally' | 'pending_sync' | 'synced' | 'failed' | 'conflict';

export interface UserProfile {
  id: string;
  name: string;
  nameGu: string | null;
  username: string;
  email: string | null;
  role: Role;
  centreId: string | null;
  sectorId: string | null;
  blockId: string | null;
  districtId: string | null;
  supplierId: string | null;
  centre?: {
    id: string;
    name: string;
    nameGu: string | null;
    code: string;
    location: string;
    offlineCredentialSalt?: string | null;
    sector: {
      id: string;
      name: string;
      block: {
        id: string;
        name: string;
        district: { id: string; name: string };
      };
    };
  } | null;
  sector?: { id: string; name: string; blockId: string } | null;
  block?: { id: string; name: string; districtId: string } | null;
  district?: { id: string; name: string } | null;
  supplier?: { id: string; name: string; code: string } | null;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  nameGu: string;
  category: ProductCategory;
  unit: string;
  defaultDailyRate: number;
}

export interface BatchBalance {
  batchId: string;
  batchNumber: string;
  productId: string;
  productCode: string;
  productName: string;
  productNameGu: string;
  category: ProductCategory;
  unit: string;
  supplierId: string;
  supplierName: string;
  manufacturingDate: string | null;
  expiryDate: string;
  daysToExpiry: number;
  status: BatchStatus;
  balance: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
  isUsable: boolean;
}

export interface ProductInventorySummary {
  productId: string;
  productCode: string;
  productName: string;
  productNameGu: string;
  category: ProductCategory;
  unit: string;
  usableStock: number;
  expiredStock: number;
  quarantinedStock: number;
  damagedStock: number;
  totalStock: number;
  averageDailyConsumption: number;
  isConsumptionEstimated: boolean;
  daysOfStock: number | null;
  reorderLevel: ReorderLevel;
  expiringSoonBatches: number;
  expiredBatches: number;
  batches: BatchBalance[];
}

export interface BeneficiaryReference {
  id: string;
  centreId: string;
  localReference: string;
  displayName: string;
  displayNameGu: string | null;
  yob?: string | null;
  beneficiaryCategory: string;
  protectedCredentialReference: string;
  status?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  reviewRemarks?: string | null;
  createdAt?: string;
  centre?: { id: string; name: string; nameGu?: string | null; code: string };
  requester?: { id: string; name: string; role: Role } | null;
  reviewer?: { id: string; name: string; role: Role } | null;
}

export interface DispatchRecord {
  id: string;
  supplierId: string;
  destinationCentreId: string;
  stockRequestId?: string | null;
  dispatchReference: string;
  status: DispatchStatus;
  dispatchDate: string;
  evidenceUrl: string | null;
  notes: string | null;
  supplier: { id: string; name: string; code: string };
  destinationCentre: {
    id: string;
    name: string;
    nameGu: string | null;
    code: string;
    location: string;
    sector?: { id: string; name: string; block?: { id: string; name: string } };
  };
  items: Array<{
    id: string;
    productId: string;
    batchId: string;
    expectedQuantity: number;
    product: Product;
    batch: { id: string; batchNumber: string; expiryDate: string; status: BatchStatus };
  }>;
  deliveryReceipt?: {
    id: string;
    expectedQuantity: number;
    acceptedQuantity: number;
    damagedQuantity: number;
    missingQuantity: number;
    evidenceUrl: string | null;
    notes: string | null;
    receivedAt: string;
    receiver?: { id: string; name: string; role: Role };
  } | null;
  discrepancyCases?: DiscrepancyCase[];
}

export interface DiscrepancyCase {
  id: string;
  dispatchId: string;
  expectedQuantity: number;
  actualQuantity: number;
  damagedQuantity: number;
  missingQuantity: number;
  difference: number;
  status: 'OPEN' | 'RECOUNT_REQUESTED' | 'APPROVED' | 'REJECTED' | 'RESOLVED';
  resolutionRemarks: string | null;
  resolvedAt: string | null;
  createdAt: string;
  dispatch?: DispatchRecord;
  deliveryReceipt?: {
    id: string;
    evidenceUrl: string | null;
    notes: string | null;
    receivedAt: string;
    receiver?: { id: string; name: string; role: Role };
  } | null;
  resolver?: { id: string; name: string; role: Role } | null;
}

export interface AlertItem {
  id: string;
  centreId: string;
  productId: string | null;
  batchId: string | null;
  alertType: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  messageGu: string;
  daysOfStock: number | null;
  isEstimated: boolean;
  createdAt: string;
  centre?: {
    id: string;
    name: string;
    nameGu: string | null;
    code: string;
    sector?: { name: string; block?: { id: string; name: string } };
  };
  product?: { id: string; name: string; nameGu: string; unit: string; category: ProductCategory } | null;
  batch?: { id: string; batchNumber: string; expiryDate: string } | null;
}

export interface DistributionRecord {
  id: string;
  centreId: string;
  beneficiaryReferenceId: string;
  productId: string;
  batchId: string;
  quantity: number;
  distributedAt: string;
  distributionDay: string;
  idempotencyKey: string;
  remarks: string | null;
  beneficiary: {
    localReference: string;
    displayName: string;
    displayNameGu: string | null;
  };
  product: { name: string; nameGu: string; unit: string };
  batch: { batchNumber: string; expiryDate?: string };
}

export type AppealStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'AWAITING_SUPPLIER_RESPONSE'
  | 'SUPPLIER_RESPONDED'
  | 'UNDER_REVIEW'
  | 'RESOLVED'
  | 'REJECTED'
  | 'ESCALATED';

export interface DispatchAppealHistory {
  id: string;
  fromStatus: AppealStatus | null;
  toStatus: AppealStatus;
  action: string;
  remarks: string | null;
  evidenceUrl?: string | null;
  createdAt: string;
  actor?: { id: string; name: string; role: Role } | null;
}

export interface DispatchAppeal {
  id: string;
  appealReference: string;
  discrepancyCaseId: string;
  dispatchId: string;
  supplierId: string;
  centreId: string;
  productId?: string | null;
  batchId?: string | null;
  dispatchedQuantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  missingQuantity: number;
  evidenceUrl?: string | null;
  supplierEvidenceUrl?: string | null;
  supervisorRemarks: string;
  supplierRemarks?: string | null;
  resolutionRemarks?: string | null;
  status: AppealStatus;
  createdAt: string;
  updatedAt: string;
  dispatch?: { id: string; dispatchReference: string; dispatchDate?: string };
  discrepancyCase?: { id: string; difference: number; status: string };
  supplier?: { id: string; name: string; code: string };
  centre?: { id: string; name: string; nameGu?: string | null; code: string };
  product?: { id: string; name: string; nameGu?: string | null; unit: string } | null;
  batch?: { id: string; batchNumber: string } | null;
  creator?: { id: string; name: string; role: Role } | null;
  responder?: { id: string; name: string; role: Role } | null;
  resolver?: { id: string; name: string; role: Role } | null;
  history?: DispatchAppealHistory[];
}

export type StockRequestReason = 'LOW_STOCK' | 'EXPECTED_DEMAND' | 'DAMAGED_STOCK' | 'OTHER';

export type StockRequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'AWAITING_DISPATCH'
  | 'DISPATCHED'
  | 'RECEIVED'
  | 'COMPLETED';

export interface StockRequestHistory {
  id: string;
  fromStatus: StockRequestStatus | null;
  toStatus: StockRequestStatus;
  action: string;
  remarks: string | null;
  createdAt: string;
  actor?: { id: string; name: string; role: Role } | null;
}

export interface StockRequest {
  id: string;
  requestNumber: string;
  centreId: string;
  productId: string;
  requestedQuantity: number;
  approvedQuantity?: number | null;
  reason: StockRequestReason;
  remarks?: string | null;
  reviewRemarks?: string | null;
  status: StockRequestStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string | null;
  centre?: {
    id: string;
    name: string;
    nameGu?: string | null;
    code: string;
    sector?: { name: string; block?: { name: string } };
  };
  product?: { id: string; name: string; nameGu?: string | null; unit: string; category: ProductCategory };
  requester?: { id: string; name: string; role: Role } | null;
  reviewer?: { id: string; name: string; role: Role } | null;
  dispatches?: Array<{ id: string; dispatchReference: string; status: DispatchStatus; supplierId: string }>;
  history?: StockRequestHistory[];
}

export interface SpoilageRecord {
  id: string;
  centreId: string;
  productId: string;
  batchId: string;
  quantity: number;
  reason: string;
  evidenceReference: string | null;
  remarks: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewRemarks: string | null;
  createdAt: string;
  centre?: { id: string; name: string; nameGu: string | null; code: string };
  product?: { id: string; name: string; nameGu: string; unit: string; category: ProductCategory };
  batch?: { id: string; batchNumber: string; expiryDate: string };
  reporter?: { id: string; name: string; role: Role };
}

export interface ReconciliationRecord {
  id: string;
  centreId: string;
  productId: string;
  batchId: string;
  calculatedStock: number;
  physicalStock: number;
  variance: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  remarks: string | null;
  approvalRemarks: string | null;
  verifiedAt: string;
  centre?: { id: string; name: string; nameGu: string | null; code: string };
  product?: { id: string; name: string; nameGu: string; unit: string; category: ProductCategory };
  batch?: { id: string; batchNumber: string; expiryDate: string };
  verifier?: { id: string; name: string; role: Role };
}

