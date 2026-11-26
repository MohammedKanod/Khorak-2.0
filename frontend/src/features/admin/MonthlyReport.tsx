import { useState } from 'react';
import { Download } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { downloadCsv } from '../../lib/exportCsv';
export function MonthlyReport() {
  const [month, setMonth] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function exportReport() {
    setBusy(true); setMessage('');
    try {
      const { data } = await apiRequest<{ data: { rows: { centreCode: string; centre: string; sector: string; block: string; product: string; unit: string; event: string; quantity: number; records: number }[] } }>(`/api/governance/reports/monthly?month=${month}`);
      downloadCsv(`khorak-monthly-${month}.csv`, [['Month (IST)', 'Centre code', 'Centre', 'Sector', 'Block', 'Product', 'Unit', 'Event', 'Quantity', 'Records'], ...data.rows.map(r => [month, r.centreCode, r.centre, r.sector, r.block, r.product, r.unit, r.event, r.quantity, r.records])]);
      setMessage(`${data.rows.length} summary rows exported for ${month}.`);
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Export failed'); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 border-t border-[var(--border)] pt-5"><h3 className="font-bold">Monthly compliance report</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">Receipts, distribution, consumption, wastage and adjustments grouped by centre and product. Uses the full ledger for the selected IST month, within your access scope.</p><div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm font-semibold">Reporting month<input aria-label="Reporting month" type="month" className="k-input mt-1" value={month} onChange={e => setMonth(e.target.value)} /></label><button className="k-btn-primary" disabled={busy || !month} onClick={() => void exportReport()}><Download size={16} />{busy ? 'Preparing report…' : 'Export monthly CSV'}</button></div>{message && <p role="status" className="mt-3 text-sm">{message}</p>}</section>;
}
