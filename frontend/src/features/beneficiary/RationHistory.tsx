import { useState } from 'react';
import { Wheat, ShieldCheck, CalendarDays } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { LiveSyncStatus } from '../../components/LiveSyncStatus';
import { LoadingSkeleton } from '../../components/ui';

interface RationData {
  month: string;
  balances: { id: string; name: string; centre: { name: string }; product: { name: string; unit: string } | null; monthlyLimit: number | null; received: number; remaining: number | null; status: string }[];
  history: { id: string; beneficiaryReferenceId: string; quantity: number; distributedAt: string; product: { name: string; unit: string }; centre: { name: string } }[];
}
export function RationHistory() {
  const [data, setData] = useState<RationData | null>(null);
  const sync = useLiveRefresh(async () => { const res = await apiRequest<{ data: RationData }>('/api/beneficiary-portal/rations'); setData(res.data); });
  const history = data?.history || [];
  return <section className="space-y-5"><div className="section-heading"><div><p className="form-eyebrow">YOUR NUTRITION RECORD</p><h1>Take-home ration</h1><p>See what has been collected and what remains this month.</p></div><span className="month-chip"><CalendarDays size={17} />{data ? new Date(`${data.month}-01T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'This month'}</span></div><LiveSyncStatus {...sync} />
    {!data ? <LoadingSkeleton rows={3} /> : !data.balances.length ? <div className="verification-empty"><ShieldCheck size={40} /><h2>Your account needs verification</h2><p>Contact your Anganwadi worker to verify the beneficiary record linked to your login.</p><small>Only your own recorded distributions and monthly quota appear here.</small></div> : <>
      <div className="ration-balance-grid">{data.balances.map(b => <article className="k-card ration-balance" key={b.id}><div className="flex items-start justify-between gap-3"><div><h2>{b.name}</h2><p>{b.centre.name}</p></div><Wheat size={24} /></div><div className="ration-amount"><strong>{b.remaining ?? '—'}</strong><span>{b.product?.unit || 'ration'} remaining</span></div>{b.monthlyLimit !== null ? <><progress aria-label={`${b.name}: collected ration`} max={b.monthlyLimit || 1} value={Math.min(b.received, b.monthlyLimit)} /><div className="ration-figures"><span>Collected <strong>{b.received}</strong></span><span>Monthly allowance <strong>{b.monthlyLimit}</strong></span></div><p className="mt-4 text-sm">{b.product?.name}</p></> : <p className="form-notice">{b.status === 'NO_THR' ? 'This category receives centre-based services rather than a take-home ration allowance.' : 'Your centre has not configured a monthly allowance yet.'}</p>}</article>)}</div>
      <p className="text-sm text-[var(--text-secondary)]">Balance follows the current calendar month in India and recorded distributions. Collection is subject to centre verification and stock availability.</p>
      <section className="k-card collection-history"><div className="section-heading"><div><h2>Collection history</h2><p>Latest 100 recorded take-home ration entries</p></div></div>{!history.length ? <p className="py-8 text-center text-[var(--text-muted)]">No ration collections recorded yet.</p> : history.map(h => <article className="collection-row" key={h.id}><span className="collection-icon"><Wheat size={20} /></span><div><strong>{h.product.name}</strong><p>{data.balances.find(b => b.id === h.beneficiaryReferenceId)?.name} · {h.centre.name}</p><small>{new Date(h.distributedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</small></div><span className="collection-quantity">{h.quantity}<small>{h.product.unit}</small></span></article>)}</section>
    </>}
  </section>;
}
