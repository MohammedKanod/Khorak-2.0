import { useId, useState } from 'react';
import { Menu, X, Wheat } from 'lucide-react';
import { useI18n } from '../locales/translations';
export function WorkspaceSidebar({ children, title }: { children: React.ReactNode; title: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { lang } = useI18n();
  return <aside className="workspace-sidebar"><div className="workspace-mobile-bar"><span className="flex items-center gap-2"><Wheat size={22} /><strong>KHORAK</strong><small>{title}</small></span><button type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? <X size={23} /> : <Menu size={23} />}</button></div><div id={id} className={`workspace-menu ${open ? 'is-open' : ''}`} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }} onClick={e => { if ((e.target as HTMLElement).closest('nav button')) setOpen(false); }}>{children}<button className="workspace-close" onClick={() => setOpen(false)}>{lang === 'gu' ? 'મેનુ બંધ કરો' : 'Close menu'}</button></div></aside>;
}
