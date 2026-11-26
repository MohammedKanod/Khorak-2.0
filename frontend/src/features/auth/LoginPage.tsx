import { useState } from 'react';
import { ArrowUpRight, Eye, EyeOff, HeartHandshake, Leaf, LockKeyhole, ShieldCheck, Users, Wheat } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../locales/translations';
import { apiRequest } from '../../lib/api';

const accounts = [
  ['AWW', 'Centre worker', 'aww.vavdi'], ['AWH', 'Centre helper · view only', 'awh.vavdi'],
  ['Supplier', 'Dispatch & delivery', 'supplier.gcmmfl'], ['Supervisor', 'Sector supervision', 'sup.godhra'],
  ['CDPO', 'Block operations', 'cdpo.godhra'], ['TDO', 'Block oversight', 'tdo.godhra'],
  ['DPO', 'District programme', 'dpo.panchmahal'], ['DDO', 'District executive', 'ddo.panchmahal'],
];

export function LoginPage() {
  const { login, isOnline } = useAuth();
  const { lang, setLang } = useI18n();
  const gu = lang === 'gu';
  const [portal, setPortal] = useState<'staff' | 'guardian'>('staff');
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('aww.vavdi');
  const [password, setPassword] = useState('Khorak@2026');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function choosePortal(value: 'staff' | 'guardian') {
    setPortal(value); setRegister(false); setError('');
    setUsername(value === 'staff' ? 'aww.vavdi' : '');
    setPassword(value === 'staff' ? 'Khorak@2026' : '');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (register) await apiRequest('/api/auth/guardian-register', { method: 'POST', skipAuth: true, body: JSON.stringify({ name, username, password }) });
      await login(username, password, portal);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in'); }
    finally { setBusy(false); }
  }
  return <div className="welcome-page">
    <header className="welcome-header"><a href="/" className="brand-lockup"><span className="brand-symbol"><Wheat size={24} /></span><span><strong>KHORAK <span className="font-normal">ખોરાક</span></strong><small>{gu ? 'પોષણ માટે જોડાયેલા' : 'Connected for better nutrition'}</small></span></a><button type="button" className="k-btn-secondary" onClick={() => setLang(gu ? 'en' : 'gu')}>{gu ? 'English' : 'ગુજરાતી'}</button></header>
    <main className="welcome-grid">
      <section className="welcome-story"><div className="welcome-kicker"><span />{gu ? 'આંગણવાડી પોષણ સહાય' : 'ANGANWADI NUTRITION NETWORK'}</div><h1>{gu ? 'દરેક પરિવાર સુધી.' : 'Good nutrition.'}<br /><em>{gu ? 'કાળજી સાથે.' : 'Closer to home.'}</em></h1><p>{gu ? 'પરિવારો, આંગણવાડી કેન્દ્રો અને અધિકારીઓને એક જ વિશ્વસનીય વ્યવસ્થામાં જોડીએ.' : 'Connecting families, Anganwadi centres and programme teams in one dependable place.'}</p>
        <div className="care-illustration" aria-hidden="true"><div className="care-orbit orbit-one" /><div className="care-orbit orbit-two" /><div className="care-centre"><HeartHandshake size={62} strokeWidth={1.25} /><span>Care that reaches everyone</span></div><span className="care-label label-family"><Users size={18} />Families</span><span className="care-label label-centre"><Wheat size={18} />Anganwadi</span><span className="care-label label-support"><Leaf size={18} />Nutrition</span></div>
        <div className="welcome-promise"><ShieldCheck size={20} /><div><strong>{gu ? 'યોગ્ય માહિતી. યોગ્ય લોકો.' : 'The right information. The right people.'}</strong><p>{gu ? 'ભૂમિકા પ્રમાણે સુરક્ષિત પ્રવેશ.' : 'Private family requests and role-based staff access.'}</p></div></div>
      </section>
      <section className="welcome-form-panel"><div className="portal-switch" role="tablist" aria-label="Login portal"><button role="tab" aria-selected={portal === 'staff'} onClick={() => choosePortal('staff')}><ShieldCheck size={18} />{gu ? 'કર્મચારી લૉગિન' : 'Staff login'}</button><button role="tab" aria-selected={portal === 'guardian'} onClick={() => choosePortal('guardian')}><Users size={18} />{gu ? 'વાલી લૉગિન' : 'Guardian login'}</button></div>
        <div className="px-1"><p className="form-eyebrow">{portal === 'staff' ? 'PROGRAMME WORKSPACE' : 'FAMILY SUPPORT'}</p><h2 className="mt-2 text-3xl font-bold">{register ? (gu ? 'તમારું ખાતું બનાવો' : 'Let’s get you started') : (gu ? 'ફરી સ્વાગત છે' : 'Welcome back')}</h2><p className="mt-3 text-base text-[var(--text-secondary)]">{portal === 'staff' ? (gu ? 'તમારા કેન્દ્ર અને કાર્યક્રમનું સંચાલન કરવા પ્રવેશ કરો.' : 'Sign in to manage your centre and keep nutrition services moving.') : (gu ? 'નજીકના કેન્દ્રમાં મદદ માગો અને અરજીની સ્થિતિ જુઓ.' : 'Request support from your Anganwadi centre and follow every step.')}</p>
          {!isOnline && <p className="form-notice mt-4">{gu ? 'સર્વર સાથે જોડાણ ઉપલબ્ધ નથી.' : 'The server is currently unreachable. Check your connection.'}</p>}
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <form onSubmit={submit} className="mt-7 space-y-5">
            {register && <label className="block text-sm font-semibold">{gu ? 'તમારું નામ' : 'Your full name'}<input className="k-input mt-2" value={name} onChange={e => setName(e.target.value)} autoComplete="name" minLength={2} maxLength={100} required /></label>}
            <label className="block text-sm font-semibold">{gu ? 'વપરાશકર્તા નામ' : 'Username'}<input className="k-input mt-2" value={username} onChange={e => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" spellCheck={false} pattern={register ? '[a-z0-9][a-z0-9._-]{3,39}' : undefined} title={register ? '4–40 lowercase letters, numbers, dots, hyphens or underscores' : undefined} required /></label>
            <label className="block text-sm font-semibold">{gu ? 'પાસવર્ડ' : 'Password'}<span className="relative mt-2 block"><input className="k-input pr-12" type={visible ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 10 : 4} maxLength={72} required /><button className="password-toggle" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></span>{register && <span className="mt-2 block text-sm font-normal text-[var(--text-muted)]">{gu ? 'ઓછામાં ઓછા 10 અક્ષર.' : 'Use at least 10 characters. Keep your password private.'}</span>}</label>
            <button className="k-btn-primary w-full" disabled={busy}>{busy ? (gu ? 'કૃપા કરીને રાહ જુઓ…' : 'Please wait…') : register ? (gu ? 'ખાતું બનાવો' : 'Create guardian account') : (gu ? 'પ્રવેશ કરો' : `Sign in as ${portal === 'staff' ? 'staff' : 'guardian'}`)}</button>
          </form>
          {portal === 'guardian' && <p className="mt-5 text-center text-sm text-[var(--text-secondary)]">{register ? 'Already registered?' : 'New to KHORAK?'} <button className="font-bold text-[var(--accent)] underline underline-offset-4" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Sign in' : 'Create an account'}</button></p>}
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]"><LockKeyhole size={14} />{portal === 'guardian' ? 'Only you and authorised centre staff see your requests.' : 'Access is limited to your assigned service area.'}</p>
        </div>
      </section>
    </main>
    {portal === 'staff' && <section className="demo-section"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="form-eyebrow">EXPLORE THE DEMO</p><h2 className="mt-1 text-xl font-bold">A workspace for every responsibility</h2></div><p className="text-sm text-[var(--text-secondary)]">Synthetic data · Demo password: <code>Khorak@2026</code></p></div><div className="demo-grid">{accounts.map(([role, label, account]) => <button key={role} onClick={() => { setUsername(account); setPassword('Khorak@2026'); setError(''); document.querySelector('form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><span className="flex items-center justify-between"><strong>{role}</strong><ArrowUpRight size={16} /></span><small>{label}</small><span className="demo-username">{account}</span></button>)}</div></section>}
    <footer className="welcome-footer"><span>KHORAK · Panchmahal, Gujarat</span><span>Seva First Innovation Challenge 2026 · Synthetic demonstration</span></footer>
  </div>;
}
