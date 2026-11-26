import { Building2, LockKeyhole, Network, Users } from 'lucide-react';
import { OfficerRole, officerRoles } from './roleConfig';
export interface HierarchyCentre { centreId: string; centreName: string; code: string; sectorId: string; sectorName: string; blockId: string; blockName: string; hasStockout: boolean; hasLowStock: boolean }

export function HierarchyView({ centres, role, onOpenCentre }: { centres: HierarchyCentre[]; role: OfficerRole; onOpenCentre: (centre: HierarchyCentre) => void }) {
  const chain = [
    { id: 'MWCD', name: 'Ministry · MWCD', level: 'National', detail: 'Policy & funding' },
    { id: 'STATE', name: 'State WCD Department', level: 'State', detail: 'State-level monitoring' },
    { id: 'DPO', name: 'District Programme Officer', level: 'District', detail: 'District analytics & compliance' },
    { id: 'CDPO', name: 'Child Development Project Officer', level: 'Block', detail: 'Stock orders & supplier coordination' },
    { id: 'SUPERVISOR', name: 'Supervisor · Mukhya Sevika', level: 'Sector', detail: 'Verification, inspection & exceptions' },
    { id: 'AWW', name: 'Anganwadi Worker & Helper', level: 'Centre', detail: 'AWW records operations · AWH views stock' },
  ];
  const blocks = [...new Map(centres.map(c => [c.blockId, { id: c.blockId, name: c.blockName }])).values()];
  return <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <section className="k-card p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-bold"><Network size={20} />ICDS administrative hierarchy</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">Service records move upward through the administrative chain.</p>
        <ol className="hierarchy-chain mt-6">{chain.map(node => <li key={node.id} className={node.id === role ? 'hierarchy-current' : ''}><span className="text-sm text-[var(--text-secondary)]">{node.level}</span><strong className="block">{node.name}</strong><p className="text-sm text-[var(--text-secondary)]">{node.detail}</p>{node.id === role && <span className="scope-chip mt-2">Your role</span>}</li>)}</ol>
        <div className="mt-6 rounded-xl bg-[var(--bg-sunken)] p-4 text-sm"><strong>Beneficiaries</strong><p>Children 0–6 years, pregnant women, lactating mothers and adolescent girls.</p><p className="mt-2">SHG / suppliers deliver food stock to centres. TDO provides block oversight; DDO provides district executive oversight.</p></div>
      </section>
      <section className="space-y-4"><div className="k-card p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><LockKeyhole size={20} />Your access boundary</h2><p className="mt-2 font-semibold">{officerRoles[role].title}</p><p className="mt-2 text-sm text-[var(--text-secondary)]">{officerRoles[role].responsibility}</p><p className="mt-3 text-sm">Only assigned {role === 'SUPERVISOR' ? 'sector' : role === 'CDPO' || role === 'TDO' ? 'block' : 'district'} records are available. Other areas are excluded by the server.</p></div>
        {blocks.map(block => {
          const members = centres.filter(c => c.blockId === block.id);
          const sectors = [...new Map(members.map(c => [c.sectorId, c.sectorName])).entries()];
          return <section key={block.id} className="k-card overflow-hidden"><h3 className="flex items-center justify-between border-b border-[var(--border)] p-4 font-bold"><span className="flex items-center gap-2"><Building2 size={18} />{block.name}</span><span className="text-sm font-normal">{members.length} centres</span></h3><div className="space-y-4 p-4">{sectors.map(([id, name]) => <details key={id} open={blocks.length === 1}><summary className="cursor-pointer font-semibold">{name} <span className="text-sm font-normal text-[var(--text-secondary)]">· {members.filter(c => c.sectorId === id).length} centres</span></summary><div className="mt-3 space-y-2">{members.filter(c => c.sectorId === id).map(c => <button className="hierarchy-centre" key={c.centreId} onClick={() => onOpenCentre(c)}><Users size={16} /><span className="flex-1 text-left"><strong className="block text-sm">{c.centreName}</strong><span className="text-sm text-[var(--text-secondary)]">{c.code}</span></span><span className={`text-sm ${c.hasStockout ? 'text-red-700' : c.hasLowStock ? 'text-amber-700' : 'text-emerald-700'}`}>{c.hasStockout ? 'Stockout' : c.hasLowStock ? 'Low stock' : 'Available'}</span></button>)}</div></details>)}</div></section>;
        })}
      </section>
    </div>
  </div>;
}
