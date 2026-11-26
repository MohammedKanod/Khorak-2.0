import { useState } from 'react';
import { Users } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { LiveSyncStatus } from '../../components/LiveSyncStatus';
import { useAuth } from '../../contexts/AuthContext';
import { FamilyRequest, categoryLabels, statusLabels } from './types';
export function FamilyRequestInbox() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<FamilyRequest[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [decision, setDecision] = useState('APPROVED');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canReview = user?.role === 'AWW' || user?.role === 'SUPERVISOR';
  const sync = useLiveRefresh(async () => { const res = await apiRequest<{ data: FamilyRequest[] }>('/api/guardian/requests'); setRequests(res.data); });
  async function review(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await apiRequest(`/api/guardian/requests/${target}/review`, { method: 'POST', body: JSON.stringify({ status: decision, remarks }) }); setTarget(null); setRemarks(''); await sync.refresh(); setMessage('Decision saved. The guardian can now see your instructions.'); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Unable to review'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4"><div className="k-card p-5"><h2 className="flex items-center gap-2 text-xl font-bold"><Users size={22} />Family support requests</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">Requests from guardians to centres in your scope. Verify details before inviting a family to visit. Approval does not create a beneficiary or issue stock.</p></div><LiveSyncStatus {...sync} />{message && <p role="status" className="k-card p-4">{message}</p>}{requests.length === 0 ? <div className="k-card p-7"><h3 className="font-semibold">No family requests yet</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">Requests submitted through Guardian login will appear here automatically.</p></div> : requests.map(r => <article className="k-card p-5" key={r.id}><div className="flex flex-wrap justify-between gap-2"><span className={`request-status status-${r.status.toLowerCase()}`}>{statusLabels[r.status]}</span><span className="text-sm text-[var(--text-muted)]">{r.reference}</span></div><h3 className="mt-4 text-lg font-bold">{r.beneficiaryName}</h3><p className="text-sm text-[var(--text-secondary)]">{categoryLabels[r.category]} · Birth year {r.birthYear}</p><p className="mt-2 text-sm">Guardian: {r.guardian.name}<br />{r.centre.name} · {r.centre.code}</p>{r.message && <p className="mt-3 rounded-lg bg-[var(--bg)] p-3 text-sm">{r.message}</p>}{r.reviewRemarks && <p className="mt-3 text-sm"><strong>Centre response:</strong> {r.reviewRemarks}</p>}{canReview && ['PENDING', 'NEEDS_INFO'].includes(r.status) && (target === r.id ? <form onSubmit={review} className="mt-4 space-y-3"><label className="block text-sm font-semibold">Decision<select className="k-select mt-1" value={decision} onChange={e => setDecision(e.target.value)}><option value="APPROVED">Invite to centre for verification</option><option value="NEEDS_INFO">Request more information</option><option value="DECLINED">Decline with an explanation</option></select></label><label className="block text-sm font-semibold">Instructions for the guardian<textarea className="k-textarea mt-1" value={remarks} onChange={e => setRemarks(e.target.value)} required minLength={5} maxLength={1000} /></label><div className="flex gap-2"><button className="k-btn-primary" disabled={busy}>Save decision</button><button type="button" className="k-btn-secondary" onClick={() => setTarget(null)}>Cancel</button></div></form> : <button className="k-btn-primary mt-4" onClick={() => { setTarget(r.id); setRemarks(''); setDecision('APPROVED'); }}>Review request</button>)}</article>)}</section>;
}
