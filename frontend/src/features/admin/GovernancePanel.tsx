import { useState } from 'react';
import { ClipboardCheck, Send, Truck, PackagePlus } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { ProductInventorySummary } from '../../types';
import { OfficerRole } from './roleConfig';
import { HierarchyCentre } from './HierarchyView';
export interface SupplierProfile { id: string; blockId: string; supplierId: string; contactInformation: string; isActive: boolean; supplier: { id: string; name: string; code: string }; block: { name: string } }
export interface OperationalNote { id: string; authorName: string; authorRole: string; kind: string; message: string; createdAt: string; centre: { name: string; code: string } }
type Centre = HierarchyCentre & { products: ProductInventorySummary[] };

export function GovernancePanel({ mode, role, centres, notes, suppliers, reload }: { mode: 'notes' | 'supply'; role: OfficerRole; centres: Centre[]; notes: OperationalNote[]; suppliers: SupplierProfile[]; reload: () => Promise<void> }) {
  const [centreId, setCentreId] = useState(centres[0]?.centreId ?? '');
  const [kind, setKind] = useState(role === 'CDPO' ? 'ANOMALY' : 'INSPECTION');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [contact, setContact] = useState('');
  const [editing, setEditing] = useState<SupplierProfile | null>(null);
  const [active, setActive] = useState(true);
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [orderKey, setOrderKey] = useState(() => crypto.randomUUID());
  const canWrite = role === 'CDPO' || role === 'SUPERVISOR';
  const centre = centres.find(c => c.centreId === centreId);
  async function save(work: () => Promise<unknown>, success: string, reset: () => void) {
    setBusy(true); setFeedback('');
    try { await work(); reset(); await reload(); setFeedback(success); }
    catch (err) { setFeedback(err instanceof Error ? err.message : 'Unable to save'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    {feedback && <p role="status" className="k-card border-l-4 border-l-[var(--accent)] p-4">{feedback}</p>}
    {mode === 'notes' ? <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.3fr]">
      <section className="k-card p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><ClipboardCheck size={20} />{canWrite ? 'Record an observation' : 'Programme observations'}</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">Inspection notes and shortage flags reach the CDPO. CDPO anomaly flags are visible in district oversight.</p>
        {canWrite ? <form className="mt-5 space-y-4" onSubmit={e => { e.preventDefault(); void save(() => apiRequest('/api/governance/notes', { method: 'POST', body: JSON.stringify({ centreId, kind, message }) }), 'Observation recorded and available to the officers above your scope.', () => setMessage('')); }}>
          <label className="block text-sm font-semibold">Centre<select className="k-select mt-1" value={centreId} onChange={e => setCentreId(e.target.value)} required>{centres.map(c => <option value={c.centreId} key={c.centreId}>{c.centreName}</option>)}</select></label>
          <label className="block text-sm font-semibold">Observation type<select className="k-select mt-1" value={kind} onChange={e => setKind(e.target.value)}>{role === 'SUPERVISOR' ? <><option value="INSPECTION">Inspection note</option><option value="SHORTAGE">Shortage flag to CDPO</option></> : <><option value="ANOMALY">Anomaly flag to DPO</option><option value="SHORTAGE">Supply shortage</option></>}</select></label>
          <label className="block text-sm font-semibold">Details<textarea className="k-textarea mt-1" value={message} onChange={e => setMessage(e.target.value)} required minLength={10} maxLength={2000} rows={5} placeholder="Describe what you observed and the support required." /></label>
          <button className="k-btn-primary" disabled={busy || !centreId}><Send size={16} />Submit observation</button>
        </form> : <div className="mt-5 rounded-xl bg-[var(--accent-subtle)] p-4 text-sm">Your role reviews and exports information. Contact the responsible CDPO for operational follow-up.</div>}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-bold">Observations in your scope <span className="text-[var(--text-muted)]">({notes.length})</span></h2>{notes.length === 0 && <div className="k-card p-8"><h3 className="font-semibold">No observations yet</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">New inspection notes and escalation flags will appear automatically.</p></div>}{notes.map(note => <article className="k-card p-5" key={note.id}><div className="flex flex-wrap items-center justify-between gap-2"><span className="scope-chip">{note.kind.replaceAll('_', ' ')}</span><time className="text-sm text-[var(--text-muted)]">{new Date(note.createdAt).toLocaleString()}</time></div><h3 className="mt-3 font-semibold">{note.centre.name}</h3><p className="mt-2 whitespace-pre-wrap text-sm">{note.message}</p><p className="mt-4 text-sm text-[var(--text-secondary)]">{note.authorName} · {note.authorRole} · {note.centre.code}</p></article>)}</section>
    </div> : <>
      {role === 'CDPO' && <section className="k-card p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-bold"><PackagePlus size={20} />Issue a stock order</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">Assign an order to a block supplier. Stock changes only after physical receipt at the centre.</p><form className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e => { e.preventDefault(); void save(() => apiRequest('/api/stock-requests', { method: 'POST', body: JSON.stringify({ centreId, productId, assignedSupplierId: supplierId, requestedQuantity: Number(quantity), reason: 'EXPECTED_DEMAND', remarks: reason, idempotencyKey: orderKey }) }), 'Stock order issued to the selected supplier.', () => { setQuantity(''); setReason(''); setOrderKey(crypto.randomUUID()); }); }}>
        <label className="text-sm font-semibold">Centre<select className="k-select mt-1" value={centreId} onChange={e => { setCentreId(e.target.value); setProductId(''); }} required>{centres.map(c => <option key={c.centreId} value={c.centreId}>{c.centreName}</option>)}</select></label>
        <label className="text-sm font-semibold">Product<select className="k-select mt-1" value={productId} onChange={e => setProductId(e.target.value)} required><option value="">Choose product</option>{centre?.products.map(p => <option key={p.productId} value={p.productId}>{p.productName} ({p.unit})</option>)}</select></label>
        <label className="text-sm font-semibold">Supplier<select className="k-select mt-1" value={supplierId} onChange={e => setSupplierId(e.target.value)} required><option value="">Choose supplier</option>{suppliers.filter(s => s.isActive).map(s => <option key={s.id} value={s.supplierId}>{s.supplier.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Quantity<input className="k-input mt-1" type="number" min="0.5" max="5000" step="0.5" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label>
        <label className="text-sm font-semibold">Order remarks<input className="k-input mt-1" value={reason} onChange={e => setReason(e.target.value)} required maxLength={400} /></label><div className="flex items-end"><button className="k-btn-primary" disabled={busy}>Issue stock order</button></div>
      </form></section>}
      <div className="grid items-start gap-5 lg:grid-cols-2"><section className="space-y-3"><h2 className="flex items-center gap-2 text-lg font-bold"><Truck size={20} />Block supplier directory</h2>{suppliers.length === 0 && <p className="k-card p-5">No suppliers are assigned to this block yet.</p>}{suppliers.map(s => <article key={s.id} className="k-card p-5"><div className="flex justify-between gap-3"><h3 className="font-bold">{s.supplier.name}</h3><span className="scope-chip">{s.isActive ? 'Active' : 'Inactive'}</span></div><p className="mt-1 text-sm text-[var(--text-secondary)]">{s.supplier.code} · {s.block.name}</p><p className="mt-3 text-sm">{s.contactInformation}</p>{role === 'CDPO' && <button className="k-btn-secondary mt-4" onClick={() => { setEditing(s); setName(s.supplier.name); setCode(s.supplier.code); setContact(s.contactInformation); setActive(s.isActive); }}>Edit block record</button>}</article>)}</section>
        {role === 'CDPO' && <form className="k-card space-y-4 p-5" onSubmit={e => { e.preventDefault(); void save(() => apiRequest(editing ? `/api/governance/suppliers/${editing.id}` : '/api/governance/suppliers', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(editing ? { contactInformation: contact, isActive: active } : { name, code, contactInformation: contact }) }), 'Block supplier record saved.', () => { setEditing(null); setName(''); setCode(''); setContact(''); }); }}><h2 className="text-lg font-bold">{editing ? 'Edit block supplier' : 'Add a block supplier'}</h2><p className="text-sm text-[var(--text-secondary)]">Use an existing supplier code to link it to your block. Contact details and activation apply only to your block.</p><label className="block text-sm font-semibold">Supplier name<input className="k-input mt-1" value={name} onChange={e => setName(e.target.value)} required minLength={3} maxLength={150} disabled={Boolean(editing)} /></label><label className="block text-sm font-semibold">Supplier code<input className="k-input mt-1" value={code} onChange={e => setCode(e.target.value)} required minLength={3} maxLength={40} disabled={Boolean(editing)} /></label><label className="block text-sm font-semibold">Contact details<textarea className="k-textarea mt-1" value={contact} onChange={e => setContact(e.target.value)} required minLength={3} maxLength={500} /></label>{editing && <label className="flex gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Active in this block</label>}<div className="flex gap-2"><button className="k-btn-primary" disabled={busy}>Save supplier</button>{editing && <button type="button" className="k-btn-secondary" onClick={() => { setEditing(null); setName(''); setCode(''); setContact(''); }}>Cancel</button>}</div></form>}
      </div>
    </>}
  </div>;
}
