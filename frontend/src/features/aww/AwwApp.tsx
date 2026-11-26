import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardList,
  History,
  Home,
  LogOut,
  PackageCheck,
  PackagePlus,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Truck,
  User,
  UserPlus,
  Utensils,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../locales/translations';
import { apiRequest } from '../../lib/api';
import {
  computeOfflineEntitlementSummary,
  enqueueOfflineOperation,
  getCachedSnapshot,
  listOutboxOperations,
  OutboxRecord,
  pullCentreSnapshot,
  syncOutboxOperations,
} from '../../lib/offlineDb';
import {
  AlertItem,
  BENEFICIARY_CATEGORY_OPTIONS,
  BeneficiaryEntitlementSummary,
  BeneficiaryReference,
  DispatchRecord,
  DistributionRecord,
  EntitlementRule,
  MonthlyDistributionLite,
  ProductInventorySummary,
  StockRequest,
  StockRequestReason,
} from '../../types';
import {
  EmptyState,
  LoadingSkeleton,
  ModalDialog,
  OutboxStatusBadge,
  StatusBadge,
  SyncStatusPill,
} from '../../components/ui';
import { QrScannerModal, QrScannerPanel } from '../../components/QrScannerModal';
import { ParsedOfflineCredential, SYNTHETIC_DEMO_QR_SAMPLES } from '../../lib/aadhaarQr';

type Tab = 'home' | 'inventory' | 'distribution' | 'history' | 'profile';

export function AwwApp() {
  const { user, isOnline, logout, refreshConnectivity } = useAuth();
  const { lang, setLang, t } = useI18n();
  const isAwh = user?.role === 'AWH';
  const centreId = user?.centreId || '';

  const [tab, setTab] = useState<Tab>('home');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [inventory, setInventory] = useState<ProductInventorySummary[]>([]);
  const [pendingDispatches, setPendingDispatches] = useState<DispatchRecord[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryReference[]>([]);
  const [distributions, setDistributions] = useState<DistributionRecord[]>([]);
  const [entitlementRules, setEntitlementRules] = useState<EntitlementRule[]>([]);
  const [monthlyDistributions, setMonthlyDistributions] = useState<MonthlyDistributionLite[]>([]);
  const [ledgerEvents, setLedgerEvents] = useState<Array<{
    id: string;
    eventType: string;
    quantity: number;
    remarks: string | null;
    createdAt: string;
    product: { name: string; nameGu: string; unit: string };
    batch: { batchNumber: string };
  }>>([]);
  const [outbox, setOutbox] = useState<OutboxRecord[]>([]);
  const [stockRequests, setStockRequests] = useState<StockRequest[]>([]);
  const [centreSalt, setCentreSalt] = useState<string | null>(
    () => user?.centre?.offlineCredentialSalt ?? null
  );

  // Modals
  const [receiveTarget, setReceiveTarget] = useState<DispatchRecord | null>(null);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [benQrOpen, setBenQrOpen] = useState(false);
  const [distModalOpen, setDistModalOpen] = useState(false);
  const [usageModalOpen, setUsageModalOpen] = useState(false);
  const [spoilageModalOpen, setSpoilageModalOpen] = useState(false);
  const [stockRequestModalOpen, setStockRequestModalOpen] = useState(false);
  const [addBenOpen, setAddBenOpen] = useState(false);
  const [qrPreviewBen, setQrPreviewBen] = useState<{
    beneficiary: BeneficiaryReference;
    dataUrl: string;
  } | null>(null);

  // Add Beneficiary form state (QR-first + manual fallback, zero Aadhaar digits)
  const [benMode, setBenMode] = useState<'qr' | 'manual'>('qr');
  const [benCredRef, setBenCredRef] = useState<string | null>(null);
  const [benScannedFormat, setBenScannedFormat] = useState<string | null>(null);
  const [benName, setBenName] = useState('');
  const [benNameGu, setBenNameGu] = useState('');
  const [benYob, setBenYob] = useState('1998');
  const [benCategory, setBenCategory] = useState('PREGNANT_WOMAN');

  // Stock Request form state
  const [reqProductId, setReqProductId] = useState('');
  const [reqQuantity, setReqQuantity] = useState('25');
  const [reqReason, setReqReason] = useState<StockRequestReason>('LOW_STOCK');
  const [reqRemarks, setReqRemarks] = useState('');

  // Entitlement-Validated Distribution form state
  const [matchedBeneficiary, setMatchedBeneficiary] = useState<BeneficiaryReference | null>(null);
  const [verifiedLabel, setVerifiedLabel] = useState<string | null>(null);
  const [distEntitlement, setDistEntitlement] = useState<BeneficiaryEntitlementSummary | null>(null);
  const [distBatchId, setDistBatchId] = useState('');
  const [distQty, setDistQty] = useState('1');
  const [submitting, setSubmitting] = useState(false);

  function getCategoryLabel(category: string): string {
    const found = BENEFICIARY_CATEGORY_OPTIONS.find((opt) => opt.value === category);
    if (!found) return category;
    return lang === 'gu' ? found.labelGu : found.label;
  }

  // Receive form state
  const [receiptQuantities, setReceiptQuantities] = useState<
    Record<string, { accepted: string; damaged: string }>
  >({});
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // Usage (HCM / general) form state
  const [usageProductId, setUsageProductId] = useState('');
  const [usageQty, setUsageQty] = useState('2');
  const [usageRemarks, setUsageRemarks] = useState('');

  // Spoilage form state
  const [spoilProductId, setSpoilProductId] = useState('');
  const [spoilBatchId, setSpoilBatchId] = useState('');
  const [spoilQty, setSpoilQty] = useState('1');
  const [spoilReason, setSpoilReason] = useState('Moisture / storage damage');
  const [spoilFile, setSpoilFile] = useState<File | null>(null);

  // Inventory filter
  const [invCategory, setInvCategory] = useState<'ALL' | 'THR' | 'HCM'>('ALL');
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  async function loadData() {
    if (!centreId) return;
    setLoading(true);
    try {
      const outboxItems = await listOutboxOperations(centreId);
      setOutbox(outboxItems);

      const reachable = await refreshConnectivity();
      if (reachable) {
        const [snap, ledgerRes, reqRes] = await Promise.all([
          pullCentreSnapshot(centreId),
          apiRequest<{ success: boolean; data: typeof ledgerEvents }>(
            `/api/inventory/${centreId}/ledger`
          ).catch(() => null),
          apiRequest<{ success: boolean; data: StockRequest[] }>('/api/stock-requests').catch(
            () => null
          ),
        ]);
        if (snap) {
          setInventory(snap.inventorySummary);
          setPendingDispatches(snap.pendingDispatches);
          setAlerts(snap.alerts);
          setBeneficiaries(snap.beneficiaries);
          setDistributions(snap.recentDistributions);
          setEntitlementRules(snap.entitlementRules ?? []);
          setMonthlyDistributions(snap.monthlyDistributions ?? []);
          setStockRequests(reqRes?.data ?? snap.stockRequests ?? []);
          if (snap.offlineCredentialSalt) setCentreSalt(snap.offlineCredentialSalt);
        }
        if (ledgerRes) {
          setLedgerEvents(ledgerRes.data);
        }
      } else {
        const cached = await getCachedSnapshot(centreId);
        if (cached) {
          setInventory(cached.inventorySummary);
          setPendingDispatches(cached.pendingDispatches);
          setAlerts(cached.alerts);
          setBeneficiaries(cached.beneficiaries);
          setDistributions(cached.recentDistributions);
          setEntitlementRules(cached.entitlementRules ?? []);
          setMonthlyDistributions(cached.monthlyDistributions ?? []);
          setStockRequests(cached.stockRequests ?? []);
          if (cached.offlineCredentialSalt) setCentreSalt(cached.offlineCredentialSalt);
        }
      }
    } catch (err) {
      const cached = await getCachedSnapshot(centreId);
      if (cached) {
        setInventory(cached.inventorySummary);
        setPendingDispatches(cached.pendingDispatches);
        setAlerts(cached.alerts);
        setBeneficiaries(cached.beneficiaries);
        setDistributions(cached.recentDistributions);
        setEntitlementRules(cached.entitlementRules ?? []);
        setMonthlyDistributions(cached.monthlyDistributions ?? []);
        setStockRequests(cached.stockRequests ?? []);
        if (cached.offlineCredentialSalt) setCentreSalt(cached.offlineCredentialSalt);
      } else {
        setBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Unable to load centre data',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [centreId]);

  async function handleSyncNow() {
    if (!centreId) return;
    setSyncing(true);
    try {
      const res = await syncOutboxOperations(centreId);
      await loadData();
      setBanner({
        type: res.conflicts > 0 || res.failed > 0 ? 'error' : 'success',
        text:
          lang === 'gu'
            ? `સિંક પૂર્ણ: ${res.synced} સફળ, ${res.conflicts} તકરાર, ${res.failed} નિષ્ફળ`
            : `Sync complete: ${res.synced} synced, ${res.conflicts} conflicts, ${res.failed} failed`,
      });
    } finally {
      setSyncing(false);
    }
  }

  function openReceiveForDispatch(d: DispatchRecord) {
    setReceiveTarget(d);
    const map: Record<string, { accepted: string; damaged: string }> = {};
    for (const item of d.items) {
      map[`${item.productId}:${item.batchId}`] = {
        accepted: String(item.expectedQuantity),
        damaged: '0',
      };
    }
    setReceiptQuantities(map);
    setReceiptNotes('');
    setReceiptFile(null);
    setReceiveModalOpen(true);
  }

  async function submitReceiveStock(e: React.FormEvent) {
    e.preventDefault();
    if (!receiveTarget) return;
    setSubmitting(true);
    setBanner(null);

    const itemsPayload = receiveTarget.items.map((item) => {
      const entry = receiptQuantities[`${item.productId}:${item.batchId}`] || {
        accepted: String(item.expectedQuantity),
        damaged: '0',
      };
      const accepted = Number(entry.accepted || 0);
      const damaged = Number(entry.damaged || 0);
      const missing = Math.max(0, Number((item.expectedQuantity - accepted - damaged).toFixed(3)));
      return {
        productId: item.productId,
        batchId: item.batchId,
        acceptedQuantity: accepted,
        damagedQuantity: damaged,
        missingQuantity: missing,
      };
    });

    const opUuid = `rcpt-${receiveTarget.id}-${crypto.randomUUID().slice(0, 8)}`;

    try {
      const reachable = await refreshConnectivity();
      if (!reachable) {
        await enqueueOfflineOperation({
          operationUuid: opUuid,
          operationType: 'RECEIVE_DISPATCH',
          centreId,
          userId: user!.id,
          summaryLabel: `Receive ${receiveTarget.dispatchReference}`,
          summaryLabelGu: `ડિલિવરી સ્વીકાર ${receiveTarget.dispatchReference}`,
          payload: {
            dispatchId: receiveTarget.id,
            notes: receiptNotes,
            items: itemsPayload,
          },
        });
        setReceiveModalOpen(false);
        await loadData();
        setBanner({
          type: 'success',
          text:
            lang === 'gu'
              ? 'ઓફલાઇન સાચવેલ — નેટવર્ક આવતાં આપમેળે સિંક થશે.'
              : 'Saved locally — will sync automatically when online.',
        });
        return;
      }

      const form = new FormData();
      form.append('idempotencyKey', opUuid);
      form.append('notes', receiptNotes);
      form.append('items', JSON.stringify(itemsPayload));
      if (receiptFile) form.append('evidence', receiptFile);

      const res = await apiRequest<{
        success: boolean;
        data: { discrepancyCase: { difference: number } | null };
      }>(`/api/dispatches/${receiveTarget.id}/receipt`, {
        method: 'POST',
        body: form,
      });

      setReceiveModalOpen(false);
      await loadData();
      const disc = res.data.discrepancyCase;
      setBanner({
        type: 'success',
        text: disc
          ? lang === 'gu'
            ? `સ્ટોક સ્વીકાર્યો. ${disc.difference} એકમનો તફાવત સુપરવાઇઝર તપાસ માટે નોંધાયો.`
            : `Stock received. Discrepancy of ${disc.difference} unit(s) automatically flagged for Supervisor.`
          : lang === 'gu'
            ? 'સંપૂર્ણ સ્ટોક સફળતાપૂર્વક લેજરમાં ઉમેરાયો.'
            : 'Full delivery verified and added to stock ledger.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to record receipt',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQrVerified(cred: ParsedOfflineCredential) {
    setQrOpen(false);
    setBanner(null);

    // First try local cached beneficiaries (works 100% offline!)
    let match = beneficiaries.find(
      (b) => b.protectedCredentialReference === cred.protectedCredentialReference
    );
    let serverEntitlement: BeneficiaryEntitlementSummary | null = null;

    const online = await refreshConnectivity();
    if (!match && online) {
      try {
        const res = await apiRequest<{
          success: boolean;
          data: {
            beneficiary: BeneficiaryReference;
            entitlement?: BeneficiaryEntitlementSummary | null;
          };
        }>('/api/beneficiaries/verify-offline-credential', {
          method: 'POST',
          body: JSON.stringify({
            centreId,
            protectedCredentialReference: cred.protectedCredentialReference,
          }),
        });
        match = res.data.beneficiary;
        serverEntitlement = res.data.entitlement ?? null;
      } catch (err) {
        setBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Beneficiary credential not found at this centre',
        });
        return;
      }
    }

    if (!match) {
      setBanner({
        type: 'error',
        text:
          lang === 'gu'
            ? `લાભાર્થી (${cred.name}, YOB ${cred.yob}) આ કેન્દ્રની યાદીમાં મળ્યા નથી. પહેલા નવા લાભાર્થી તરીકે નોંધો.`
            : `Beneficiary (${cred.name}, YOB ${cred.yob}) is not registered in this centre. Register via Add Beneficiary first.`,
      });
      return;
    }

    if (match.status && match.status !== 'APPROVED') {
      setBanner({
        type: 'error',
        text:
          match.status === 'PENDING_APPROVAL'
            ? lang === 'gu'
              ? `${match.displayNameGu || match.displayName} ની નોંધણી મુખ્ય સેવિકાની મંજૂરીની રાહ જોઈ રહી છે.`
              : `${match.displayName} is awaiting Mukhya Sevika (Supervisor) approval before receiving rations.`
            : lang === 'gu'
              ? `${match.displayNameGu || match.displayName} ની અરજી નામંજૂર થયેલ છે.`
              : `${match.displayName} was rejected by Supervisor.`,
      });
      return;
    }

    if (!serverEntitlement && online) {
      try {
        const entRes = await apiRequest<{
          success: boolean;
          data: BeneficiaryEntitlementSummary;
        }>(
          `/api/entitlements/beneficiary/${encodeURIComponent(match.id)}?centreId=${encodeURIComponent(centreId)}`
        );
        serverEntitlement = entRes.data;
      } catch {
        // Fall back to offline calculation below if server query fails transiently
      }
    }

    const freshOutbox = await listOutboxOperations(centreId);
    const computedEntitlement =
      serverEntitlement ??
      computeOfflineEntitlementSummary({
        beneficiary: match,
        entitlementRules,
        monthlyDistributions,
        inventorySummary: inventory,
        outbox: freshOutbox,
      });

    setMatchedBeneficiary(match);
    setVerifiedLabel(`${cred.format} • Local Credential Match`);
    setDistEntitlement(computedEntitlement);
    setDistBatchId('');
    setDistQty(computedEntitlement.maxAllocatable > 0 ? '1' : '0');
    setDistModalOpen(true);
  }

  async function submitDistribution(e: React.FormEvent) {
    e.preventDefault();
    if (!matchedBeneficiary || !distEntitlement) return;

    if (!distEntitlement.canDistribute || !distEntitlement.product) {
      setBanner({
        type: 'error',
        text:
          lang === 'gu'
            ? 'આ લાભાર્થી હાલમાં આ મહિને પોષણ વિતરણ માટે પાત્ર નથી.'
            : 'Beneficiary is not eligible for ration distribution in the current status.',
      });
      return;
    }

    const qty = Number(distQty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > distEntitlement.maxAllocatable) {
      setBanner({
        type: 'error',
        text:
          lang === 'gu'
            ? `જથ્થો 1 થી ${distEntitlement.maxAllocatable} ની વચ્ચે હોવો જોઈએ.`
            : `Quantity must be between 1 and ${distEntitlement.maxAllocatable}.`,
      });
      return;
    }

    setSubmitting(true);
    setBanner(null);

    const opUuid = `dist-${crypto.randomUUID()}`;
    const payload = {
      centreId,
      beneficiaryReferenceId: matchedBeneficiary.id,
      productId: distEntitlement.product.id,
      ...(distBatchId ? { batchId: distBatchId } : {}),
      quantity: qty,
      idempotencyKey: opUuid,
    };

    try {
      const reachable = await refreshConnectivity();
      if (!reachable) {
        const latestOutbox = await listOutboxOperations(centreId);
        const revalidated = computeOfflineEntitlementSummary({
          beneficiary: matchedBeneficiary,
          entitlementRules,
          monthlyDistributions,
          inventorySummary: inventory,
          outbox: latestOutbox,
        });
        if (!revalidated.canDistribute || qty > revalidated.maxAllocatable) {
          setDistEntitlement(revalidated);
          setBanner({
            type: 'error',
            text:
              lang === 'gu'
                ? 'માસિક મર્યાદા અથવા ઉપલબ્ધ સ્ટોક કરતાં વધુ વિતરણ શક્ય નથી.'
                : `Cannot exceed remaining monthly entitlement (${revalidated.maxAllocatable} packets).`,
          });
          setSubmitting(false);
          return;
        }

        const prodLabel =
          lang === 'gu' ? distEntitlement.product.nameGu : distEntitlement.product.name;
        const weightSuffix = distEntitlement.packetWeightLabel
          ? ` (${distEntitlement.packetWeightLabel})`
          : '';
        await enqueueOfflineOperation({
          operationUuid: opUuid,
          operationType: 'DISTRIBUTION',
          centreId,
          userId: user!.id,
          summaryLabel: `Distribute ${qty} ${distEntitlement.product.unit} ${distEntitlement.product.name}${weightSuffix} to ${matchedBeneficiary.displayName}`,
          summaryLabelGu: `${matchedBeneficiary.displayNameGu || matchedBeneficiary.displayName} ને ${qty} ${distEntitlement.product.unit} ${prodLabel}${weightSuffix} વિતરણ`,
          payload,
        });
        setDistModalOpen(false);
        await loadData();
        setBanner({
          type: 'success',
          text:
            lang === 'gu'
              ? 'પોષણ વિતરણ સ્થાનિક રીતે સાચવેલ — ઓનલાઇન થતાં સિંક થશે.'
              : 'Ration distribution saved locally — pending synchronisation.',
        });
        return;
      }

      await apiRequest('/api/distributions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setDistModalOpen(false);
      await loadData();
      setBanner({
        type: 'success',
        text:
          lang === 'gu'
            ? `${matchedBeneficiary.displayNameGu || matchedBeneficiary.displayName} ને ${qty} પેકેટ ${distEntitlement.product.nameGu} વિતરણ નોંધાયું.`
            : `${qty} ${distEntitlement.product.unit} of ${distEntitlement.product.name} recorded for ${matchedBeneficiary.displayName}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Distribution failed',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitUsage(e: React.FormEvent) {
    e.preventDefault();
    if (!usageProductId) return;
    setSubmitting(true);
    setBanner(null);
    const opUuid = `usage-${crypto.randomUUID()}`;
    const prod = inventory.find((p) => p.productId === usageProductId);

    try {
      const reachable = await refreshConnectivity();
      if (!reachable) {
        await enqueueOfflineOperation({
          operationUuid: opUuid,
          operationType: 'CONSUMPTION',
          centreId,
          userId: user!.id,
          summaryLabel: `Usage ${usageQty} ${prod?.unit || ''} ${prod?.productName || ''}`,
          summaryLabelGu: `વપરાશ ${usageQty} ${prod?.productNameGu || ''}`,
          payload: {
            centreId,
            productId: usageProductId,
            quantity: Number(usageQty),
            remarks: usageRemarks || 'Daily HCM consumption',
          },
        });
        setUsageModalOpen(false);
        await loadData();
        setBanner({
          type: 'success',
          text: lang === 'gu' ? 'વપરાશ સ્થાનિક રીતે સાચવેલ.' : 'Usage saved locally.',
        });
        return;
      }

      await apiRequest('/api/inventory/consumption', {
        method: 'POST',
        body: JSON.stringify({
          centreId,
          productId: usageProductId,
          quantity: Number(usageQty),
          remarks: usageRemarks || 'Daily HCM meal preparation',
          idempotencyKey: opUuid,
        }),
      });
      setUsageModalOpen(false);
      await loadData();
      setBanner({
        type: 'success',
        text: lang === 'gu' ? 'સ્ટોક વપરાશ લેજરમાં નોંધાયો.' : 'Stock usage recorded in ledger.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to record usage',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSpoilage(e: React.FormEvent) {
    e.preventDefault();
    if (!spoilProductId || !spoilBatchId) return;
    setSubmitting(true);
    setBanner(null);
    const opUuid = `spoil-${crypto.randomUUID()}`;
    const prod = inventory.find((p) => p.productId === spoilProductId);

    try {
      const reachable = await refreshConnectivity();
      if (!reachable) {
        await enqueueOfflineOperation({
          operationUuid: opUuid,
          operationType: 'SPOILAGE',
          centreId,
          userId: user!.id,
          summaryLabel: `Spoilage ${spoilQty} ${prod?.productName || ''}`,
          summaryLabelGu: `બગાડ ${spoilQty} ${prod?.productNameGu || ''}`,
          payload: {
            centreId,
            productId: spoilProductId,
            batchId: spoilBatchId,
            quantity: Number(spoilQty),
            reason: spoilReason,
          },
        });
        setSpoilageModalOpen(false);
        await loadData();
        setBanner({
          type: 'success',
          text: lang === 'gu' ? 'બગાડ અહેવાલ સ્થાનિક સાચવેલ.' : 'Spoilage report saved locally.',
        });
        return;
      }

      const form = new FormData();
      form.append('centreId', centreId);
      form.append('productId', spoilProductId);
      form.append('batchId', spoilBatchId);
      form.append('quantity', spoilQty);
      form.append('reason', spoilReason);
      form.append('idempotencyKey', opUuid);
      if (spoilFile) form.append('evidence', spoilFile);

      await apiRequest('/api/inventory/spoilage', { method: 'POST', body: form });
      setSpoilageModalOpen(false);
      await loadData();
      setBanner({
        type: 'success',
        text:
          lang === 'gu'
            ? 'બગાડ અહેવાલ સુપરવાઇઝર મંજૂરી માટે મોકલાયો.'
            : 'Spoilage report submitted for Supervisor review.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to submit spoilage report',
      });
    } finally {
      setSubmitting(false);
    }
  }

  function openAddBeneficiaryModal() {
    setBenMode('qr');
    setBenCredRef(null);
    setBenScannedFormat(null);
    setBenName('');
    setBenNameGu('');
    setBenYob('1998');
    setBenCategory('PREGNANT_WOMAN');
    setAddBenOpen(true);
  }

  function handleBenQrScanned(cred: ParsedOfflineCredential) {
    setBenQrOpen(false);
    const dup = beneficiaries.find(
      (b) =>
        b.protectedCredentialReference === cred.protectedCredentialReference ||
        (b.displayName.toLowerCase() === cred.name.toLowerCase() && (b.yob || '') === cred.yob)
    );
    if (dup) {
      setBanner({
        type: 'error',
        text:
          lang === 'gu'
            ? `${dup.displayNameGu || dup.displayName} (${dup.localReference}) પહેલેથી જ નોંધાયેલા છે.`
            : `${dup.displayName} (${dup.localReference}) is already registered at this centre.`,
      });
      return;
    }
    setBenName(cred.name);
    setBenYob(cred.yob);
    setBenCredRef(cred.protectedCredentialReference);
    setBenScannedFormat(cred.format);
  }

  async function submitAddBeneficiary(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);
    const opUuid = `ben-${crypto.randomUUID()}`;
    const payload = {
      centreId,
      displayName: benName,
      displayNameGu: benNameGu || undefined,
      yob: benYob,
      beneficiaryCategory: benCategory,
      ...(benCredRef ? { protectedCredentialReference: benCredRef } : {}),
      idempotencyKey: opUuid,
    };

    try {
      if (!(await refreshConnectivity())) {
        await enqueueOfflineOperation({
          operationUuid: opUuid,
          operationType: 'CREATE_BENEFICIARY',
          centreId,
          userId: user!.id,
          summaryLabel: `Register Beneficiary ${benName}`,
          summaryLabelGu: `નવા લાભાર્થી નોંધણી: ${benNameGu || benName}`,
          payload,
        });
        setAddBenOpen(false);
        await loadData();
        setBanner({
          type: 'success',
          text:
            lang === 'gu'
              ? 'લાભાર્થી નોંધણી સ્થાનિક રીતે સાચવેલ — ઓનલાઇન થતાં મુખ્ય સેવિકા મંજૂરી માટે જશે.'
              : 'Beneficiary saved offline — will sync for Mukhya Sevika approval when online.',
        });
        return;
      }

      await apiRequest('/api/beneficiaries', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAddBenOpen(false);
      await loadData();
      setBanner({
        type: 'success',
        text:
          lang === 'gu'
            ? 'લાભાર્થી નોંધણી મુખ્ય સેવિકા (સુપરવાઇઝર) ની મંજૂરી માટે મોકલાઈ છે.'
            : 'Beneficiary request submitted and pending Mukhya Sevika (Supervisor) approval.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to add beneficiary',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitStockRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!reqProductId) return;
    setSubmitting(true);
    setBanner(null);
    const opUuid = `sreq-${crypto.randomUUID()}`;
    const prod = inventory.find((p) => p.productId === reqProductId);
    const payload = {
      centreId,
      productId: reqProductId,
      requestedQuantity: Number(reqQuantity),
      reason: reqReason,
      remarks: reqRemarks || undefined,
      idempotencyKey: opUuid,
    };

    try {
      if (!(await refreshConnectivity())) {
        await enqueueOfflineOperation({
          operationUuid: opUuid,
          operationType: 'CREATE_STOCK_REQUEST',
          centreId,
          userId: user!.id,
          summaryLabel: `Request ${reqQuantity} ${prod?.unit || ''} ${prod?.productName || ''}`,
          summaryLabelGu: `સ્ટોક વિનંતી: ${reqQuantity} ${prod?.productNameGu || ''}`,
          payload,
        });
        setStockRequestModalOpen(false);
        setReqRemarks('');
        await loadData();
        setBanner({
          type: 'success',
          text:
            lang === 'gu'
              ? 'સ્ટોક વિનંતી સ્થાનિક રીતે સાચવેલ — ઓનલાઇન થતાં સુપરવાઇઝરને મોકલાશે.'
              : 'Stock request saved offline — will sync automatically when online.',
        });
        return;
      }

      await apiRequest('/api/stock-requests', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStockRequestModalOpen(false);
      setReqRemarks('');
      await loadData();
      setBanner({
        type: 'success',
        text:
          lang === 'gu'
            ? 'સ્ટોક વિનંતી સુપરવાઇઝરની મંજૂરી માટે મોકલાઈ.'
            : 'Stock replenishment request submitted for Supervisor review.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to submit stock request',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function openBeneficiaryQrCard(b: BeneficiaryReference) {
    const sampleMatch = SYNTHETIC_DEMO_QR_SAMPLES.find(
      (s) => s.localReference === b.localReference
    );
    const qrPayload = sampleMatch ? sampleMatch.xmlPayload : `khorak-ref:${b.localReference}`;
    const dataUrl = await QRCode.toDataURL(qrPayload, {
      width: 220,
      margin: 1,
      color: { dark: '#1B4332', light: '#FFFFFF' },
    });
    setQrPreviewBen({ beneficiary: b, dataUrl });
  }

  const pendingOutboxCount = outbox.filter((o) => o.status !== 'synced').length;
  const totalUsableUnits = inventory.reduce((s, p) => s + p.usableStock, 0);
  const criticalOrWarningAlerts = alerts.filter(
    (a) => a.severity === 'CRITICAL' || a.severity === 'WARNING'
  );

  const selectedSpoilProduct = inventory.find((p) => p.productId === spoilProductId);

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-24">
      {/* Sticky Top Bar */}
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg-raised)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-bold text-white">
                ખો
              </span>
              <span className="font-display truncate text-base font-bold text-[var(--accent)]">
                {t('appTitle')}
              </span>
              <span className="rounded bg-[var(--saffron-subtle)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                {user?.role}
              </span>
            </div>
            <p className="truncate text-xs text-[var(--text-secondary)]">
              {lang === 'gu' ? user?.centre?.nameGu || user?.centre?.name : user?.centre?.name} •{' '}
              {user?.centre?.code}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === 'gu' ? 'en' : 'gu')}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-sunken)] px-2.5 py-1.5 text-xs font-bold text-[var(--text-primary)]"
            >
              {lang === 'gu' ? 'EN' : 'ગુજ'}
            </button>
            {isAwh && (
              <button
                type="button"
                onClick={logout}
                aria-label={t('signOut')}
                className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-secondary)]"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-4">
        <SyncStatusPill
          isOnline={isOnline}
          pendingCount={pendingOutboxCount}
          syncing={syncing}
          onSyncClick={handleSyncNow}
        />

        {banner && (
          <div
            role="status"
            className={`flex items-start justify-between gap-2 rounded-xl border px-3.5 py-3 text-sm ${
              banner.type === 'success'
                ? 'border-emerald-200 bg-[var(--success-subtle)] text-[var(--success)]'
                : 'border-red-200 bg-[var(--danger-subtle)] text-[var(--danger)]'
            }`}
          >
            <span>{banner.text}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs font-bold underline"
            >
              OK
            </button>
          </div>
        )}

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : (
          <>
            {/* TAB 1: HOME */}
            {tab === 'home' && (
              <div className="space-y-4">
                {/* Greeting Card */}
                <section className="rounded-2xl bg-[var(--accent)] p-4 text-white">
                  <p className="text-xs text-emerald-100">{t('syntheticBanner')}</p>
                  <h1 className="mt-1 text-xl font-bold">
                    {t('namasteGreeting')}, {lang === 'gu' ? user?.nameGu || user?.name : user?.name}
                  </h1>
                  <p className="mt-0.5 text-xs text-emerald-100">
                    {user?.centre?.sector?.block?.name} • {user?.centre?.location}
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-white/10 p-3 text-center">
                    <div>
                      <div className="font-mono-num text-lg font-bold">{totalUsableUnits}</div>
                      <div className="text-[11px] text-emerald-100">{t('usable')}</div>
                    </div>
                    <div>
                      <div className="font-mono-num text-lg font-bold">
                        {pendingDispatches.length}
                      </div>
                      <div className="text-[11px] text-emerald-100">{t('pendingDeliveries')}</div>
                    </div>
                    <div>
                      <div className="font-mono-num text-lg font-bold">
                        {criticalOrWarningAlerts.length}
                      </div>
                      <div className="text-[11px] text-emerald-100">
                        {lang === 'gu' ? 'ચેતવણી' : 'Alerts'}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Primary Action Grid (4–6 large touch targets) */}
                <section aria-label="Primary actions">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setQrOpen(true)}
                      className="flex min-h-[76px] flex-col items-start justify-between rounded-xl border-2 border-[var(--saffron)] bg-[var(--saffron-subtle)] p-3.5 text-left transition active:scale-[0.98]"
                    >
                      <QrCode className="h-6 w-6 text-[var(--saffron)]" />
                      <span className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                        {t('actionScanQr')}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (pendingDispatches.length > 0) {
                          openReceiveForDispatch(pendingDispatches[0]);
                        } else {
                          setBanner({
                            type: 'error',
                            text:
                              lang === 'gu'
                                ? 'હાલમાં કોઈ બાકી ડિલિવરી નથી.'
                                : 'No pending dispatches to receive right now.',
                          });
                        }
                      }}
                      className="flex min-h-[76px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-3.5 text-left transition active:scale-[0.98]"
                    >
                      <div className="flex w-full items-center justify-between">
                        <PackageCheck className="h-6 w-6 text-[var(--accent)]" />
                        {pendingDispatches.length > 0 && (
                          <span className="font-mono-num rounded-full bg-[var(--saffron)] px-2 py-0.5 text-xs font-bold text-white">
                            {pendingDispatches.length}
                          </span>
                        )}
                      </div>
                      <span className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                        {t('actionReceiveStock')}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTab('distribution')}
                      className="flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-3.5 text-left transition active:scale-[0.98]"
                    >
                      <CheckCircle2 className="h-5 w-5 text-[var(--accent)]" />
                      <span className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                        {t('actionDistribute')}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTab('inventory')}
                      className="flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-3.5 text-left transition active:scale-[0.98]"
                    >
                      <Archive className="h-5 w-5 text-[var(--accent)]" />
                      <span className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                        {t('actionViewInventory')}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const hcm = inventory.find((p) => p.category === 'HCM' && p.usableStock > 0) || inventory[0];
                        if (hcm) setUsageProductId(hcm.productId);
                        setUsageQty('2');
                        setUsageModalOpen(true);
                      }}
                      className="flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-3.5 text-left transition active:scale-[0.98]"
                    >
                      <Utensils className="h-5 w-5 text-[var(--accent)]" />
                      <span className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                        {t('actionRecordUsage')}
                      </span>
                    </button>

                    {!isAwh && (
                      <button
                        type="button"
                        onClick={() => {
                          const withStock = inventory.find((p) => p.batches.length > 0);
                          if (withStock) {
                            setSpoilProductId(withStock.productId);
                            setSpoilBatchId(withStock.batches[0].batchId);
                          }
                          setSpoilageModalOpen(true);
                        }}
                        className="flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-3.5 text-left transition active:scale-[0.98]"
                      >
                        <ShieldAlert className="h-5 w-5 text-[var(--danger)]" />
                        <span className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                          {t('actionReportSpoilage')}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const lowProd =
                          inventory.find(
                            (p) => p.reorderLevel === 'STOCKOUT' || p.reorderLevel === 'CRITICAL'
                          ) || inventory[0];
                        if (lowProd) setReqProductId(lowProd.productId);
                        setReqQuantity('25');
                        setReqReason('LOW_STOCK');
                        setReqRemarks('');
                        setStockRequestModalOpen(true);
                      }}
                      className="flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-3.5 text-left transition active:scale-[0.98]"
                    >
                      <PackagePlus className="h-5 w-5 text-[var(--accent)]" />
                      <span className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                        {lang === 'gu' ? 'સ્ટોક વિનંતી' : 'Request Stock'}
                      </span>
                    </button>

                    {!isAwh && (
                      <button
                        type="button"
                        onClick={openAddBeneficiaryModal}
                        className="flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-3.5 text-left transition active:scale-[0.98]"
                      >
                        <UserPlus className="h-5 w-5 text-[var(--accent)]" />
                        <span className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                          {lang === 'gu' ? 'નવા લાભાર્થી ઉમેરો' : 'Add Beneficiary'}
                        </span>
                      </button>
                    )}
                  </div>
                </section>

                {/* Pending Deliveries List */}
                {pendingDispatches.length > 0 && (
                  <section className="k-card p-4">
                    <h2 className="mb-2.5 flex items-center gap-2 text-sm font-bold">
                      <Truck className="h-4 w-4 text-[var(--saffron)]" />
                      {t('pendingDeliveries')}
                    </h2>
                    <div className="space-y-2.5">
                      {pendingDispatches.map((d) => (
                        <div
                          key={d.id}
                          className="rounded-xl border border-amber-200 bg-[var(--saffron-subtle)]/50 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono-num text-xs font-bold text-[var(--text-primary)]">
                              {d.dispatchReference}
                            </span>
                            <StatusBadge variant="warning">DISPATCHED</StatusBadge>
                          </div>
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            {d.supplier.name} • {d.items.length} item(s)
                          </p>
                          <button
                            type="button"
                            onClick={() => openReceiveForDispatch(d)}
                            className="k-btn-primary mt-2.5 min-h-[42px] w-full py-2 text-sm"
                          >
                            {t('actionReceiveStock')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Alerts Strip */}
                <section className="k-card p-4">
                  <h2 className="mb-2.5 flex items-center gap-2 text-sm font-bold">
                    <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
                    {t('stockAndExpiryAlerts')}
                  </h2>
                  {alerts.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">
                      {lang === 'gu' ? 'કોઈ તાત્કાલિક ચેતવણી નથી.' : 'No active stock or expiry alerts.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {alerts.slice(0, 5).map((a) => (
                        <div
                          key={a.id}
                          className={`rounded-xl border px-3 py-2.5 text-xs ${
                            a.severity === 'CRITICAL'
                              ? 'border-red-200 bg-[var(--danger-subtle)] text-[var(--danger)]'
                              : a.severity === 'WARNING'
                                ? 'border-amber-200 bg-[var(--saffron-subtle)] text-[var(--warning)]'
                                : 'border-[var(--border)] bg-[var(--bg-sunken)] text-[var(--text-secondary)]'
                          }`}
                        >
                          <p className="font-semibold">{lang === 'gu' ? a.messageGu : a.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* TAB 2: INVENTORY */}
            {tab === 'inventory' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h1 className="text-lg font-bold">{t('navInventory')}</h1>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const lowProd =
                          inventory.find(
                            (p) => p.reorderLevel === 'STOCKOUT' || p.reorderLevel === 'CRITICAL'
                          ) || inventory[0];
                        if (lowProd) setReqProductId(lowProd.productId);
                        setReqQuantity('25');
                        setReqReason('LOW_STOCK');
                        setReqRemarks('');
                        setStockRequestModalOpen(true);
                      }}
                      className="k-btn-saffron min-h-[34px] px-3 py-1 text-xs"
                    >
                      <PackagePlus className="h-3.5 w-3.5" />
                      {lang === 'gu' ? 'સ્ટોક વિનંતી' : 'Request Stock'}
                    </button>
                    {(['ALL', 'THR', 'HCM'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setInvCategory(cat)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                          invCategory === cat
                            ? 'bg-[var(--accent)] text-white'
                            : 'border border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {inventory
                  .filter((p) => invCategory === 'ALL' || p.category === invCategory)
                  .map((p) => {
                    const expanded = expandedProductId === p.productId;
                    const badgeVariant =
                      p.reorderLevel === 'STOCKOUT' || p.reorderLevel === 'CRITICAL'
                        ? 'critical'
                        : p.reorderLevel === 'WARNING'
                          ? 'warning'
                          : 'normal';
                    return (
                      <div key={p.productId} className="k-card overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedProductId(expanded ? null : p.productId)
                          }
                          className="flex w-full items-center justify-between gap-3 p-4 text-left"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-[var(--bg-sunken)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
                                {p.category}
                              </span>
                              <span className="truncate font-bold text-[var(--text-primary)]">
                                {lang === 'gu' ? p.productNameGu : p.productName}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--text-secondary)]">
                              {p.daysOfStock !== null ? `${p.daysOfStock} ${t('daysLeft')}` : '—'} •{' '}
                              {p.averageDailyConsumption} {p.unit}/day{' '}
                              {p.isConsumptionEstimated && `(${t('estimated')})`}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono-num text-lg font-bold text-[var(--accent)]">
                              {p.usableStock}{' '}
                              <span className="text-xs font-normal text-[var(--text-secondary)]">
                                {p.unit}
                              </span>
                            </div>
                            <StatusBadge variant={badgeVariant}>{p.reorderLevel}</StatusBadge>
                          </div>
                        </button>

                        {expanded && (
                          <div className="border-t border-[var(--border)] bg-[var(--bg-sunken)]/50 px-4 py-3">
                            <p className="mb-2 text-xs font-bold text-[var(--text-secondary)]">
                              FEFO Batches ({p.batches.length})
                            </p>
                            {p.batches.length === 0 ? (
                              <p className="text-xs text-[var(--text-muted)]">No stock batches recorded.</p>
                            ) : (
                              <div className="space-y-2">
                                {p.batches.map((b) => (
                                  <div
                                    key={b.batchId}
                                    className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-xs"
                                  >
                                    <div>
                                      <p className="font-mono-num font-bold">{b.batchNumber}</p>
                                      <p className="text-[11px] text-[var(--text-muted)]">
                                        Exp: {new Date(b.expiryDate).toLocaleDateString()}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="font-mono-num font-bold">
                                        {b.balance} {p.unit}
                                      </p>
                                      {b.isExpired ? (
                                        <StatusBadge variant="critical">{t('expired')}</StatusBadge>
                                      ) : b.isExpiringSoon ? (
                                        <StatusBadge variant="warning">
                                          {b.daysToExpiry}d left
                                        </StatusBadge>
                                      ) : (
                                        <StatusBadge variant="normal">FEFO OK</StatusBadge>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                {stockRequests.length > 0 && (
                  <section className="k-card p-4">
                    <h2 className="mb-2.5 text-sm font-bold">
                      {lang === 'gu'
                        ? `સ્ટોક વિનંતી સ્થિતિ (${stockRequests.length})`
                        : `Centre Stock Requests (${stockRequests.length})`}
                    </h2>
                    <div className="space-y-2">
                      {stockRequests.slice(0, 6).map((sr) => (
                        <div
                          key={sr.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-xs"
                        >
                          <div>
                            <p className="font-mono-num font-bold">{sr.requestNumber}</p>
                            <p className="text-[11px] text-[var(--text-secondary)]">
                              {lang === 'gu' ? sr.product?.nameGu || sr.product?.name : sr.product?.name} •{' '}
                              {sr.requestedQuantity} {sr.product?.unit}
                              {sr.approvedQuantity != null && ` (Approved: ${sr.approvedQuantity})`}
                            </p>
                          </div>
                          <StatusBadge
                            variant={
                              sr.status === 'COMPLETED' || sr.status === 'APPROVED' || sr.status === 'PARTIALLY_APPROVED'
                                ? 'normal'
                                : sr.status === 'REJECTED'
                                  ? 'critical'
                                  : 'warning'
                            }
                          >
                            {sr.status}
                          </StatusBadge>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* TAB 3: DISTRIBUTION — QR SCANNER IS 1ST THING */}
            {tab === 'distribution' && (
              <div className="space-y-4">
                <section className="k-card p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h1 className="text-base font-bold">
                        {lang === 'gu'
                          ? 'આધાર QR સ્કેન કરો અને વિતરણ કરો'
                          : 'Scan Aadhaar QR for Nutrition Distribution'}
                      </h1>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {lang === 'gu'
                          ? 'વિભાગ ખોલતાં જ કેમેરા સીધો QR સ્કેન કરવા તૈયાર છે.'
                          : 'Live QR camera opens immediately — scan beneficiary credential to distribute one or more items.'}
                      </p>
                    </div>
                    {!isAwh && (
                      <button
                        type="button"
                        onClick={openAddBeneficiaryModal}
                        className="k-btn-primary min-h-[38px] px-3 py-1.5 text-xs"
                      >
                        <UserPlus className="h-4 w-4" />
                        {lang === 'gu' ? 'નવા લાભાર્થી ઉમેરો' : 'Add Beneficiary'}
                      </button>
                    )}
                  </div>

                  <QrScannerPanel
                    active={
                      tab === 'distribution' &&
                      !qrOpen &&
                      !benQrOpen &&
                      !distModalOpen &&
                      !addBenOpen &&
                      !qrPreviewBen
                    }
                    onVerified={handleQrVerified}
                    centreSalt={centreSalt}
                    defaultMode="camera"
                    cameraHeightClass="h-80 sm:h-96"
                  />
                </section>

                {/* Registered Centre Beneficiaries & Sevika Approval Status */}
                <section className="k-card p-4">
                  <h2 className="mb-3 text-sm font-bold">
                    {lang === 'gu'
                      ? `કેન્દ્રના લાભાર્થીઓ અને મંજૂરી સ્થિતિ (${beneficiaries.length})`
                      : `Centre Beneficiaries & Sevika Approval (${beneficiaries.length})`}
                  </h2>
                  {beneficiaries.length === 0 ? (
                    <EmptyState
                      title={lang === 'gu' ? 'કોઈ લાભાર્થી નોંધાયેલ નથી' : 'No beneficiaries yet'}
                      description={
                        lang === 'gu'
                          ? 'નવા લાભાર્થી ઉમેરી મુખ્ય સેવિકાની મંજૂરી માટે મોકલો.'
                          : 'Tap Add Beneficiary above to submit a beneficiary for Sevika approval.'
                      }
                    />
                  ) : (
                    <div className="space-y-2">
                      {beneficiaries.map((b) => {
                        const status = b.status || 'APPROVED';
                        const entSummary =
                          status === 'APPROVED' && entitlementRules.length > 0
                            ? computeOfflineEntitlementSummary({
                                beneficiary: b,
                                entitlementRules,
                                monthlyDistributions,
                                inventorySummary: inventory,
                                outbox,
                              })
                            : null;
                        return (
                          <div
                            key={b.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-[var(--text-primary)]">
                                {lang === 'gu' ? b.displayNameGu || b.displayName : b.displayName}
                              </p>
                              <p className="font-mono-num text-[11px] text-[var(--text-muted)]">
                                {b.localReference} • YOB {b.yob || '—'} • {getCategoryLabel(b.beneficiaryCategory)}
                              </p>
                              {entSummary && (
                                <p className="mt-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                                  {entSummary.eligibilityStatus === 'PENDING_CONFIGURATION'
                                    ? lang === 'gu'
                                      ? `${entSummary.product?.nameGu || 'પૂર્ણાશક્તિ'} • સત્તાવાર મંજૂરી બાકી`
                                      : `${entSummary.product?.name || 'Purnashakti / HCM'} • Pending Official Confirmation`
                                    : `${lang === 'gu' ? entSummary.product?.nameGu : entSummary.product?.name} (${entSummary.packetWeightLabel || ''}) • ${entSummary.distributedQuantity}/${entSummary.monthlyLimit} ${lang === 'gu' ? 'વપરાયેલ' : 'distributed'} (${entSummary.remainingQuantity} ${lang === 'gu' ? 'બાકી' : 'left'})`}
                                </p>
                              )}
                              {b.reviewRemarks && (
                                <p className="mt-0.5 text-[11px] italic text-[var(--text-secondary)]">
                                  Sevika: {b.reviewRemarks}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge
                                variant={
                                  status === 'APPROVED'
                                    ? 'normal'
                                    : status === 'REJECTED'
                                      ? 'critical'
                                      : 'warning'
                                }
                              >
                                {status === 'APPROVED'
                                  ? lang === 'gu'
                                    ? 'મંજૂર'
                                    : 'Approved'
                                  : status === 'REJECTED'
                                    ? lang === 'gu'
                                      ? 'નામંજૂર'
                                      : 'Rejected'
                                    : lang === 'gu'
                                      ? 'સેવિકા મંજૂરી બાકી'
                                      : 'Pending Sevika'}
                              </StatusBadge>
                              {status === 'APPROVED' && (
                                <button
                                  type="button"
                                  onClick={() => openBeneficiaryQrCard(b)}
                                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-sunken)] px-2.5 py-1.5 text-[11px] font-semibold hover:bg-[var(--border)]"
                                >
                                  QR
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="k-card p-4">
                  <h2 className="mb-3 text-sm font-bold">
                    {lang === 'gu' ? 'તાજેતરના વિતરણો' : 'Recent Distributions'}
                  </h2>
                  {distributions.length === 0 ? (
                    <EmptyState
                      title={lang === 'gu' ? 'હજુ કોઈ વિતરણ નથી' : 'No distributions recorded yet'}
                      description={
                        lang === 'gu'
                          ? 'ઉપરના QR બટનથી પ્રથમ વિતરણ નોંધો.'
                          : 'Tap Scan Aadhaar QR above to record a ration handover.'
                      }
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {distributions.map((dist) => (
                        <div
                          key={dist.id}
                          className="flex items-center justify-between rounded-xl border border-[var(--border)] p-3 text-xs"
                        >
                          <div>
                            <p className="font-bold text-[var(--text-primary)]">
                              {lang === 'gu'
                                ? dist.beneficiary.displayNameGu || dist.beneficiary.displayName
                                : dist.beneficiary.displayName}
                            </p>
                            <p className="font-mono-num text-[11px] text-[var(--text-muted)]">
                              {dist.beneficiary.localReference} • {dist.batch.batchNumber}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono-num font-bold text-[var(--accent)]">
                              {dist.quantity} {dist.product.unit}
                            </p>
                            <p className="text-[11px] text-[var(--text-secondary)]">
                              {lang === 'gu' ? dist.product.nameGu : dist.product.name}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* TAB 4: ACTIVITY & SYNC OUTBOX */}
            {tab === 'history' && (
              <div className="space-y-4">
                <section className="k-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-bold">
                      {lang === 'gu' ? 'ઓફલાઇન સિંક આઉટબોક્સ' : 'Offline Sync Outbox'}
                    </h2>
                    <button
                      type="button"
                      onClick={handleSyncNow}
                      disabled={!isOnline || syncing}
                      className="k-btn-secondary min-h-[36px] px-3 py-1 text-xs"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                      {t('syncNow')}
                    </button>
                  </div>
                  {outbox.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      {lang === 'gu'
                        ? 'બધા વ્યવહારો સર્વર સાથે સિંક છે.'
                        : 'No queued offline operations — all records are synchronised.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {outbox.map((op) => (
                        <div
                          key={op.operationUuid}
                          className="rounded-xl border border-[var(--border)] p-3 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">
                              {lang === 'gu' ? op.summaryLabelGu : op.summaryLabel}
                            </span>
                            <OutboxStatusBadge status={op.status} />
                          </div>
                          {op.errorMessage && (
                            <p className="mt-1 text-[11px] text-[var(--danger)]">
                              {op.errorMessage}
                            </p>
                          )}
                          <p className="font-mono-num mt-1 text-[10px] text-[var(--text-muted)]">
                            {new Date(op.createdAt).toLocaleString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="k-card p-4">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
                    <ClipboardList className="h-4 w-4 text-[var(--accent)]" />
                    {lang === 'gu' ? 'સ્ટોક લેજર ઇતિહાસ' : 'Immutable Stock Ledger'}
                  </h2>
                  {ledgerEvents.length === 0 ? (
                    <EmptyState
                      title="No ledger movements"
                      description="Stock movements appear here once online."
                    />
                  ) : (
                    <div className="space-y-2">
                      {ledgerEvents.slice(0, 25).map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
                        >
                          <div>
                            <p className="font-semibold">
                              {ev.eventType} • {lang === 'gu' ? ev.product.nameGu : ev.product.name}
                            </p>
                            <p className="text-[11px] text-[var(--text-muted)]">
                              Batch {ev.batch.batchNumber} • {new Date(ev.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <span className="font-mono-num font-bold">
                            {['DISTRIBUTED', 'CONSUMED', 'SPOILAGE', 'ADJUSTMENT_OUT'].includes(
                              ev.eventType
                            )
                              ? '-'
                              : '+'}
                            {ev.quantity} {ev.product.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* TAB 5: PROFILE (AWW) */}
            {tab === 'profile' && (
              <div className="k-card space-y-4 p-5">
                <div>
                  <p className="text-xs text-[var(--text-muted)]">{user?.role}</p>
                  <h2 className="text-lg font-bold">
                    {lang === 'gu' ? user?.nameGu || user?.name : user?.name}
                  </h2>
                  <p className="font-mono-num text-xs text-[var(--text-secondary)]">
                    @{user?.username}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--bg-sunken)] p-3 text-xs space-y-1">
                  <p>
                    <strong>Centre:</strong> {user?.centre?.name} ({user?.centre?.code})
                  </p>
                  <p>
                    <strong>Sector:</strong> {user?.centre?.sector?.name}
                  </p>
                  <p>
                    <strong>Block / District:</strong> {user?.centre?.sector?.block?.name} /{' '}
                    {user?.centre?.sector?.block?.district?.name}
                  </p>
                </div>
                <button type="button" onClick={logout} className="k-btn-secondary w-full text-[var(--danger)]">
                  <LogOut className="h-4 w-4" />
                  {t('signOut')}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Bottom Tab Navigation */}
      <nav
        aria-label="Primary Mobile Navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--bg-raised)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 4px)' }}
      >
        <div className={`mx-auto grid max-w-lg ${isAwh ? 'grid-cols-4' : 'grid-cols-5'}`}>
          {[
            { id: 'home' as const, label: t('navHome'), icon: Home },
            { id: 'inventory' as const, label: t('navInventory'), icon: Archive },
            { id: 'distribution' as const, label: t('navDistribution'), icon: QrCode },
            { id: 'history' as const, label: t('navHistory'), icon: History },
            ...(!isAwh ? [{ id: 'profile' as const, label: t('navProfile'), icon: User }] : []),
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex min-h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.5]' : ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* MODAL: Receive Stock */}
      <ModalDialog
        open={receiveModalOpen}
        onClose={() => setReceiveModalOpen(false)}
        title={t('actionReceiveStock')}
        subtitle={receiveTarget?.dispatchReference}
      >
        {receiveTarget && (
          <form onSubmit={submitReceiveStock} className="space-y-4">
            {receiveTarget.items.map((item) => {
              const key = `${item.productId}:${item.batchId}`;
              const val = receiptQuantities[key] || {
                accepted: String(item.expectedQuantity),
                damaged: '0',
              };
              const missing = Math.max(
                0,
                Number(
                  (item.expectedQuantity - Number(val.accepted || 0) - Number(val.damaged || 0)).toFixed(3)
                )
              );
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-sunken)]/50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between text-sm font-bold">
                    <span>{lang === 'gu' ? item.product.nameGu : item.product.name}</span>
                    <span className="font-mono-num text-xs">
                      Expected: {item.expectedQuantity} {item.product.unit}
                    </span>
                  </div>
                  <p className="font-mono-num text-xs text-[var(--text-muted)]">
                    Batch: {item.batch.batchNumber}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold">Accepted</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={item.expectedQuantity}
                        value={val.accepted}
                        onChange={(e) =>
                          setReceiptQuantities((prev) => ({
                            ...prev,
                            [key]: { ...val, accepted: e.target.value },
                          }))
                        }
                        className="k-input min-h-[42px] py-1.5 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold">Damaged</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={item.expectedQuantity}
                        value={val.damaged}
                        onChange={(e) =>
                          setReceiptQuantities((prev) => ({
                            ...prev,
                            [key]: { ...val, damaged: e.target.value },
                          }))
                        }
                        className="k-input min-h-[42px] py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold">Missing</label>
                      <div className="font-mono-num flex min-h-[42px] items-center rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-bold text-[var(--warning)]">
                        {missing}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div>
              <label className="mb-1 block text-xs font-semibold">
                {lang === 'gu' ? 'નોંધ (તફાવત હોય તો લખો)' : 'Delivery Notes'}
              </label>
              <textarea
                rows={2}
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
                className="k-textarea text-sm"
                placeholder="Condition of crates, seals, or short receipt details..."
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold">
                {lang === 'gu' ? 'ડિલિવરી પુરાવો ફોટો (વૈકલ્પિક)' : 'Delivery Evidence Photo (Optional)'}
              </label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                className="k-input py-2 text-xs"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReceiveModalOpen(false)}
                className="k-btn-secondary flex-1"
              >
                {t('cancel')}
              </button>
              <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
                {submitting ? t('loading') : t('confirm')}
              </button>
            </div>
          </form>
        )}
      </ModalDialog>

      {/* MODAL: Aadhaar QR Scanner (Distribution) */}
      <QrScannerModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onVerified={handleQrVerified}
        centreSalt={centreSalt}
        defaultMode="camera"
      />

      {/* MODAL: Aadhaar QR Scanner (Beneficiary Registration) */}
      <QrScannerModal
        open={benQrOpen}
        onClose={() => setBenQrOpen(false)}
        onVerified={handleBenQrScanned}
        centreSalt={centreSalt}
        defaultMode="camera"
      />

      {/* MODAL: Entitlement-Validated Distribution Confirmation */}
      <ModalDialog
        open={distModalOpen}
        onClose={() => setDistModalOpen(false)}
        title={lang === 'gu' ? 'પાત્રતા ચકાસણી અને વિતરણ' : 'Beneficiary Ration Entitlement'}
        subtitle={verifiedLabel || undefined}
      >
        {matchedBeneficiary && distEntitlement && (
          <form onSubmit={submitDistribution} className="space-y-4">
            {/* Verified Beneficiary Identity Card (zero Aadhaar digits) */}
            <div className="rounded-xl border border-emerald-200 bg-[var(--success-subtle)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[var(--success)]">
                  {lang === 'gu' ? 'ચકાસાયેલ લાભાર્થી' : 'Verified Beneficiary'}
                </p>
                <StatusBadge
                  variant={
                    distEntitlement.eligibilityStatus === 'ELIGIBLE'
                      ? 'normal'
                      : distEntitlement.eligibilityStatus === 'LIMIT_EXHAUSTED'
                        ? 'critical'
                        : 'warning'
                  }
                >
                  {distEntitlement.eligibilityStatus === 'ELIGIBLE'
                    ? lang === 'gu'
                      ? 'વિતરણ માટે પાત્ર'
                      : 'Eligible'
                    : distEntitlement.eligibilityStatus === 'LIMIT_EXHAUSTED'
                      ? lang === 'gu'
                        ? 'માસિક મર્યાદા પૂર્ણ'
                        : 'Limit Exhausted'
                      : distEntitlement.eligibilityStatus === 'INSUFFICIENT_STOCK'
                        ? lang === 'gu'
                          ? 'પૂરતો સ્ટોક નથી'
                          : 'Insufficient Stock'
                        : lang === 'gu'
                          ? 'મંજૂરી બાકી'
                          : 'Pending Configuration'}
                </StatusBadge>
              </div>
              <p className="mt-0.5 text-base font-bold text-[var(--text-primary)]">
                {lang === 'gu'
                  ? matchedBeneficiary.displayNameGu || matchedBeneficiary.displayName
                  : matchedBeneficiary.displayName}
              </p>
              <p className="font-mono-num text-xs text-[var(--text-secondary)]">
                {matchedBeneficiary.localReference} • YOB {matchedBeneficiary.yob || '—'}
              </p>
              <p className="mt-1 text-xs font-semibold text-[var(--text-primary)]">
                {lang === 'gu' ? 'શ્રેણી: ' : 'Category: '}
                {getCategoryLabel(matchedBeneficiary.beneficiaryCategory)}
              </p>
            </div>

            {/* Auto-Selected Product & Packet Weight */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-sunken)]/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {lang === 'gu' ? 'આપમેળે પસંદ થયેલ પોષણ' : 'Auto-Assigned Nutrition Product'}
                  </p>
                  <p className="text-sm font-bold text-[var(--text-primary)]">
                    {distEntitlement.product
                      ? lang === 'gu'
                        ? distEntitlement.product.nameGu
                        : distEntitlement.product.name
                      : lang === 'gu'
                        ? 'આ શ્રેણી માટે THR પેકેટ લાગુ નથી'
                        : 'No THR product configured'}
                  </p>
                </div>
                {distEntitlement.packetWeightLabel && (
                  <span className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-2.5 py-1 text-xs font-bold">
                    {distEntitlement.packetWeightLabel} / {lang === 'gu' ? 'પેકેટ' : 'packet'}
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-2">
                  <p className="text-[10px] font-semibold text-[var(--text-muted)]">
                    {lang === 'gu' ? 'માસિક મર્યાદા' : 'Monthly Limit'}
                  </p>
                  <p className="font-mono-num text-sm font-bold text-[var(--text-primary)]">
                    {distEntitlement.monthlyLimit !== null ? distEntitlement.monthlyLimit : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-2">
                  <p className="text-[10px] font-semibold text-[var(--text-muted)]">
                    {lang === 'gu' ? 'આપેલ જથ્થો' : 'Distributed'}
                  </p>
                  <p className="font-mono-num text-sm font-bold text-[var(--text-primary)]">
                    {distEntitlement.distributedQuantity}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-2">
                  <p className="text-[10px] font-semibold text-[var(--text-muted)]">
                    {lang === 'gu' ? 'બાકી હક' : 'Remaining'}
                  </p>
                  <p
                    className={`font-mono-num text-sm font-bold ${
                      (distEntitlement.remainingQuantity ?? 0) > 0
                        ? 'text-[var(--success)]'
                        : 'text-[var(--danger)]'
                    }`}
                  >
                    {distEntitlement.remainingQuantity !== null
                      ? distEntitlement.remainingQuantity
                      : '—'}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                <span>
                  {lang === 'gu' ? 'મહિનો:' : 'Month:'}{' '}
                  <strong className="font-mono-num">{distEntitlement.distributionMonth}</strong>
                </span>
                {distEntitlement.product && (
                  <span>
                    {lang === 'gu' ? 'કેન્દ્ર ઉપલબ્ધ સ્ટોક:' : 'Centre Usable Stock:'}{' '}
                    <strong className="font-mono-num">
                      {distEntitlement.usableStock} {distEntitlement.product.unit}
                    </strong>
                  </span>
                )}
              </div>
            </div>

            {/* Blocking / Guidance Notice or Quantity Selection */}
            {distEntitlement.eligibilityStatus === 'LIMIT_EXHAUSTED' && (
              <div className="rounded-xl border border-rose-200 bg-[var(--danger-subtle)] p-3 text-xs font-medium text-[var(--danger)]">
                {lang === 'gu'
                  ? 'આ લાભાર્થીની ચાલુ મહિનાની રેશન મર્યાદા પૂર્ણ થઈ ગઈ છે. આવતા મહિનાની ૧ તારીખે આપમેળે નવી મર્યાદા શરૂ થશે.'
                  : 'Monthly ration entitlement is exhausted for this calendar month. Distribution will unlock automatically on the 1st of next month.'}
              </div>
            )}

            {distEntitlement.eligibilityStatus === 'PENDING_CONFIGURATION' && (
              <div className="rounded-xl border border-amber-200 bg-[var(--warning-subtle)] p-3 text-xs font-medium text-[var(--warning)]">
                {lang === 'gu'
                  ? 'આ શ્રેણી (દા.ત. કિશોરી - પૂર્ણાશક્તિ) માટે સત્તાવાર જથ્થો અને વજન હજુ નિશ્ચિત થયેલ નથી. સુપરવાઈઝર/CDPO મંજૂરી પછી વિતરણ શક્ય બનશે.'
                  : 'Entitlement quantity and packet weight for this category are pending official confirmation by CDPO/Supervisor. Distribution is blocked.'}
              </div>
            )}

            {distEntitlement.eligibilityStatus === 'INSUFFICIENT_STOCK' && (
              <div className="rounded-xl border border-amber-200 bg-[var(--warning-subtle)] p-3 text-xs font-medium text-[var(--warning)]">
                {lang === 'gu'
                  ? 'લાભાર્થી પાત્ર છે પરંતુ કેન્દ્રમાં પૂરતો વપરાશયોગ્ય સ્ટોક નથી. કૃપા કરીને સ્ટોક વિનંતી મોકલો.'
                  : 'Beneficiary has remaining monthly entitlement, but centre usable stock is 0. Raise a Stock Request first.'}
              </div>
            )}

            {distEntitlement.canDistribute && distEntitlement.product && (
              <div className="space-y-3 rounded-xl border border-[var(--border)] p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold">
                      {lang === 'gu'
                        ? `વિતરણ જથ્થો (મહત્તમ ${distEntitlement.maxAllocatable})`
                        : `Quantity to Distribute (Max ${distEntitlement.maxAllocatable})`}
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDistQty((prev) => String(Math.max(1, (Number(prev) || 1) - 1)))
                        }
                        className="k-btn-secondary min-h-[40px] px-3 text-sm font-bold"
                        disabled={Number(distQty) <= 1}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        step="1"
                        min={1}
                        max={distEntitlement.maxAllocatable}
                        value={distQty}
                        onChange={(e) => setDistQty(e.target.value)}
                        className="k-input text-center font-mono-num"
                        required
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDistQty((prev) =>
                            String(
                              Math.min(distEntitlement.maxAllocatable, (Number(prev) || 1) + 1)
                            )
                          )
                        }
                        className="k-btn-secondary min-h-[40px] px-3 text-sm font-bold"
                        disabled={Number(distQty) >= distEntitlement.maxAllocatable}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold">
                      {lang === 'gu' ? 'બેચ (આપમેળે FEFO)' : 'Batch (Auto FEFO default)'}
                    </label>
                    <select
                      value={distBatchId}
                      onChange={(e) => setDistBatchId(e.target.value)}
                      className="k-select text-xs"
                    >
                      <option value="">Auto-select FEFO (Earliest Valid)</option>
                      {(
                        inventory.find((p) => p.productId === distEntitlement.product?.id)?.batches ??
                        []
                      )
                        .filter((b) => !b.isExpired && b.balance > 0)
                        .map((b) => (
                          <option key={b.batchId} value={b.batchId}>
                            {b.batchNumber} ({b.balance} {distEntitlement.product?.unit} • Exp{' '}
                            {new Date(b.expiryDate).toLocaleDateString()})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDistModalOpen(false)}
                className="k-btn-secondary flex-1"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={
                  submitting ||
                  !distEntitlement.canDistribute ||
                  !Number.isInteger(Number(distQty)) ||
                  Number(distQty) < 1 ||
                  Number(distQty) > distEntitlement.maxAllocatable
                }
                className="k-btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t('loading') : t('confirm')}
              </button>
            </div>
          </form>
        )}
      </ModalDialog>

      {/* MODAL: Record Stock Usage (HCM / Authorised Consumption) */}
      <ModalDialog
        open={usageModalOpen}
        onClose={() => setUsageModalOpen(false)}
        title={t('actionRecordUsage')}
        subtitle={lang === 'gu' ? 'ગરમ રાંધેલો ખોરાક (HCM) વપરાશ' : 'Hot Cooked Meal / Authorised Stock Usage'}
      >
        <form onSubmit={submitUsage} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Product / Ingredient</label>
            <select
              value={usageProductId}
              onChange={(e) => setUsageProductId(e.target.value)}
              className="k-select"
              required
            >
              {inventory.map((p) => (
                <option key={p.productId} value={p.productId}>
                  [{p.category}] {lang === 'gu' ? p.productNameGu : p.productName} ({p.usableStock} {p.unit})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Quantity Used</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={usageQty}
              onChange={(e) => setUsageQty(e.target.value)}
              className="k-input"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Remarks</label>
            <input
              type="text"
              value={usageRemarks}
              onChange={(e) => setUsageRemarks(e.target.value)}
              placeholder="Morning HCM meal preparation"
              className="k-input"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setUsageModalOpen(false)} className="k-btn-secondary flex-1">
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : t('save')}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* MODAL: Report Spoilage */}
      <ModalDialog
        open={spoilageModalOpen}
        onClose={() => setSpoilageModalOpen(false)}
        title={t('actionReportSpoilage')}
        subtitle={lang === 'gu' ? 'સુપરવાઇઝર સમીક્ષા માટે મોકલો' : 'Submit damaged/spoiled batch for Supervisor approval'}
      >
        <form onSubmit={submitSpoilage} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Product</label>
            <select
              value={spoilProductId}
              onChange={(e) => {
                const pid = e.target.value;
                setSpoilProductId(pid);
                const prod = inventory.find((p) => p.productId === pid);
                setSpoilBatchId(prod?.batches[0]?.batchId || '');
              }}
              className="k-select"
              required
            >
              {inventory
                .filter((p) => p.batches.length > 0)
                .map((p) => (
                  <option key={p.productId} value={p.productId}>
                    {lang === 'gu' ? p.productNameGu : p.productName}
                  </option>
                ))}
            </select>
          </div>

          {selectedSpoilProduct && (
            <div>
              <label className="mb-1 block text-xs font-semibold">Batch</label>
              <select
                value={spoilBatchId}
                onChange={(e) => setSpoilBatchId(e.target.value)}
                className="k-select"
                required
              >
                {selectedSpoilProduct.batches.map((b) => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.batchNumber} ({b.balance} {selectedSpoilProduct.unit})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold">Spoiled Quantity</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={spoilQty}
              onChange={(e) => setSpoilQty(e.target.value)}
              className="k-input"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">Reason</label>
            <select
              value={spoilReason}
              onChange={(e) => setSpoilReason(e.target.value)}
              className="k-select"
            >
              <option value="Moisture / storage damage">Moisture / storage damage</option>
              <option value="Pest / rodent damage">Pest / rodent damage</option>
              <option value="Torn packaging">Torn packaging</option>
              <option value="Expired stock disposal">Expired stock disposal</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">Photo Evidence (Optional)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setSpoilFile(e.target.files?.[0] || null)}
              className="k-input py-2 text-xs"
            />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => setSpoilageModalOpen(false)} className="k-btn-secondary flex-1">
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : t('confirm')}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* MODAL: Add Beneficiary Reference (QR-First + Manual Fallback, Zero Aadhaar Digits) */}
      <ModalDialog
        open={addBenOpen}
        onClose={() => setAddBenOpen(false)}
        title={lang === 'gu' ? 'નવા લાભાર્થીની નોંધણી' : 'Add Beneficiary Reference'}
        subtitle={
          lang === 'gu'
            ? 'મુખ્ય સેવિકાની મંજૂરી બાદ જ વિતરણ માટે સક્રિય થશે'
            : 'Requires Mukhya Sevika (Supervisor) approval before ration distribution'
        }
      >
        <div className="space-y-4">
          {!benCredRef && benMode === 'qr' ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-[var(--accent-subtle)] p-4 text-center">
                <ShieldCheck className="mx-auto h-8 w-8 text-[var(--accent)]" />
                <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                  {lang === 'gu'
                    ? 'આધાર ઓફલાઇન QR સ્કેન કરીને સરળ નોંધણી'
                    : 'Quick Aadhaar Offline XML QR Registration'}
                </p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {lang === 'gu'
                    ? 'QR સ્થાનિક રીતે પાર્સ થાય છે. કોઈ આધાર નંબર કે છેલ્લા ૪ અંક દેખાડાતા કે સંગ્રહાતા નથી.'
                    : 'XML parses 100% locally. No Aadhaar number or last-4 digits are stored or displayed.'}
                </p>
                <button
                  type="button"
                  onClick={() => setBenQrOpen(true)}
                  className="k-btn-saffron mt-3 w-full"
                >
                  <QrCode className="h-5 w-5" />
                  {lang === 'gu' ? 'આધાર QR સ્કેન કરો' : 'Scan Aadhaar QR'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setBenMode('manual')}
                className="k-btn-secondary w-full text-xs"
              >
                {lang === 'gu'
                  ? 'QR ઉપલબ્ધ ન હોય તો મેન્યુઅલ નોંધણી'
                  : 'QR Unavailable? Use Manual Registration'}
              </button>
            </div>
          ) : (
            <form onSubmit={submitAddBeneficiary} className="space-y-3.5">
              {benCredRef && (
                <div className="rounded-xl border border-emerald-200 bg-[var(--success-subtle)] p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--success)]">
                      QR Credential Verified Locally ({benScannedFormat})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setBenCredRef(null);
                        setBenScannedFormat(null);
                      }}
                      className="font-semibold underline"
                    >
                      Rescan
                    </button>
                  </div>
                  <p className="mt-1 text-[var(--text-secondary)]">
                    Confirm extracted details below and select beneficiary category.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {lang === 'gu' ? 'પૂરું નામ' : 'Full Name'}
                </label>
                <input
                  type="text"
                  value={benName}
                  onChange={(e) => setBenName(e.target.value)}
                  placeholder="e.g. Sonalben Vijaybhai Gohil"
                  className="k-input"
                  required
                  minLength={2}
                  readOnly={Boolean(benCredRef)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {lang === 'gu' ? 'ગુજરાતીમાં નામ (વૈકલ્પિક)' : 'Name in Gujarati (Optional)'}
                </label>
                <input
                  type="text"
                  value={benNameGu}
                  onChange={(e) => setBenNameGu(e.target.value)}
                  placeholder="દા.ત. સોનલબેન વિજયભાઈ ગોહિલ"
                  className="k-input"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {lang === 'gu' ? 'જન્મ વર્ષ (YYYY)' : 'Birth Year (YYYY)'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="(19|20)\d{2}"
                  value={benYob}
                  onChange={(e) => setBenYob(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="1998"
                  className="k-input font-mono-num"
                  required
                  readOnly={Boolean(benCredRef)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold">
                  {lang === 'gu' ? 'લાભાર્થી શ્રેણી' : 'Beneficiary Category'}
                </label>
                <select
                  value={benCategory}
                  onChange={(e) => setBenCategory(e.target.value)}
                  className="k-select"
                >
                  {BENEFICIARY_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.labelGu})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddBenOpen(false)}
                  className="k-btn-secondary flex-1"
                >
                  {t('cancel')}
                </button>
                <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
                  {submitting
                    ? t('loading')
                    : lang === 'gu'
                      ? 'ખાતરી કરો અને નોંધો'
                      : 'Confirm & Register'}
                </button>
              </div>
            </form>
          )}
        </div>
      </ModalDialog>

      {/* MODAL: Request Stock Replenishment */}
      <ModalDialog
        open={stockRequestModalOpen}
        onClose={() => setStockRequestModalOpen(false)}
        title={lang === 'gu' ? 'સ્ટોક પુનઃપ્રાપ્તિ વિનંતી' : 'Request Stock Replenishment'}
        subtitle={
          lang === 'gu'
            ? 'સુપરવાઇઝરની મંજૂરી પછી સપ્લાયર દ્વારા સ્ટોક મોકલાશે'
            : 'Reviewed by Supervisor before Supplier dispatch (approval alone never alters ledger stock)'
        }
      >
        <form onSubmit={submitStockRequest} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Nutrition Product</label>
            <select
              value={reqProductId}
              onChange={(e) => setReqProductId(e.target.value)}
              className="k-select"
              required
            >
              {inventory.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {lang === 'gu' ? p.productNameGu : p.productName} ({p.usableStock} {p.unit} left)
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Quantity Requested</label>
              <input
                type="number"
                step="1"
                min="1"
                max="5000"
                value={reqQuantity}
                onChange={(e) => setReqQuantity(e.target.value)}
                className="k-input"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Reason</label>
              <select
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value as StockRequestReason)}
                className="k-select"
              >
                <option value="LOW_STOCK">Low Stock / Stockout</option>
                <option value="EXPECTED_DEMAND">Expected Demand Increase</option>
                <option value="DAMAGED_STOCK">Damaged / Expired Stock</option>
                <option value="OTHER">Other Operational Need</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Remarks (Optional)</label>
            <textarea
              rows={2}
              value={reqRemarks}
              onChange={(e) => setReqRemarks(e.target.value)}
              className="k-textarea"
              placeholder="Any urgent delivery notes for Mukhya Sevika / Supplier..."
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStockRequestModalOpen(false)}
              className="k-btn-secondary flex-1"
            >
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : 'Submit Stock Request'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* MODAL: Beneficiary Local Reference QR Card */}
      <ModalDialog
        open={Boolean(qrPreviewBen)}
        onClose={() => setQrPreviewBen(null)}
        title={qrPreviewBen?.beneficiary.displayName || 'Beneficiary QR'}
        subtitle={qrPreviewBen?.beneficiary.localReference}
      >
        {qrPreviewBen && (
          <div className="flex flex-col items-center space-y-3 text-center">
            <img
              src={qrPreviewBen.dataUrl}
              alt="Beneficiary Offline XML QR"
              className="h-52 w-52 rounded-xl border border-[var(--border)] bg-white p-2"
            />
            <p className="font-mono-num text-xs text-[var(--text-secondary)]">
              {qrPreviewBen.beneficiary.localReference} • YOB {qrPreviewBen.beneficiary.yob || '—'}
            </p>
            <a
              href={qrPreviewBen.dataUrl}
              download={`${qrPreviewBen.beneficiary.localReference}-qr.png`}
              className="k-btn-primary w-full"
            >
              {lang === 'gu' ? 'QR છબી ડાઉનલોડ કરો' : 'Download QR Image'}
            </a>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}

