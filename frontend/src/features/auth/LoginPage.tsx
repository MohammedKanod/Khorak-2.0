import React, { useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../locales/translations';

const DEMO_ACCOUNTS = [
  { role: 'AWW', label: 'AWW — Vavdi Bujarg (ગુજરાતી મોબાઇલ)', username: 'aww.vavdi' },
  { role: 'AWH', label: 'AWH — Vavdi Helper (સરળ મોબાઇલ)', username: 'awh.vavdi' },
  { role: 'SUPPLIER', label: 'Supplier — GCMMFL Panchmahal', username: 'supplier.gcmmfl' },
  { role: 'SUPERVISOR', label: 'Supervisor — Mukhya Sevika (Godhra)', username: 'sup.godhra' },
  { role: 'CDPO', label: 'CDPO — Godhra Block', username: 'cdpo.godhra' },
  { role: 'TDO', label: 'TDO / BDO — Godhra Block', username: 'tdo.godhra' },
  { role: 'DPO', label: 'DPO — Panchmahal District', username: 'dpo.panchmahal' },
  { role: 'DDO', label: 'DDO — Panchmahal Executive', username: 'ddo.panchmahal' },
];

export function LoginPage() {
  const { login, isOnline } = useAuth();
  const { lang, setLang, t } = useI18n();

  const [username, setUsername] = useState('aww.vavdi');
  const [password, setPassword] = useState('Khorak@2026');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8">
      <div className="mx-auto max-w-4xl">
        {/* Top Header */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-xl font-bold text-white">
              ખો
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-[var(--accent)]">
                {t('appTitle')}
              </h1>
              <p className="text-sm text-[var(--text-secondary)]">{t('appSubtitle')}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setLang(lang === 'gu' ? 'en' : 'gu')}
            className="k-btn-secondary min-h-[40px] px-3 py-1.5 text-xs"
          >
            {lang === 'gu' ? 'Switch to English' : 'ગુજરાતીમાં જુઓ'}
          </button>
        </header>

        <div className="grid gap-6 md:grid-cols-5">
          {/* Sign-In Card */}
          <section className="k-card p-6 md:col-span-3">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-[var(--accent)]">
              <ShieldCheck className="h-4 w-4" />
              <span>Seva First Innovation Challenge 2026 • PS000052</span>
            </div>

            <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('signIn')}</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {lang === 'gu'
                ? 'તમારી ભૂમિકા અનુસાર સુરક્ષિત પ્રવેશ કરો.'
                : 'Sign in with your role credentials for scoped supply-chain access.'}
            </p>

            {!isOnline && (
              <div
                role="status"
                className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900"
              >
                {lang === 'gu'
                  ? 'ઉપકરણ ઓફલાઇન છે. પ્રથમ વખત લૉગિન કરવા માટે ઇન્ટરનેટ જરૂરી છે; અગાઉ લૉગિન કરેલ વપરાશકર્તા ઓફલાઇન ચાલુ રાખી શકે છે.'
                  : 'Device appears offline. First-time sign-in requires an internet connection to authenticate your account.'}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-[var(--danger-subtle)] px-4 py-3 text-sm font-medium text-[var(--danger)]"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="login-username" className="mb-1.5 block text-sm font-semibold">
                  {t('username')}
                </label>
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="k-input"
                  required
                />
              </div>

              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold">
                  {t('password')}
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="k-input pr-12"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-sunken)]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={submitting} className="k-btn-primary w-full">
                <Lock className="h-4 w-4" />
                {submitting ? t('loading') : t('signIn')}
              </button>
            </form>
          </section>

          {/* Synthetic Panchmahal Demo Accounts */}
          <aside className="k-card p-5 md:col-span-2">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">{t('demoAccounts')}</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Click any role to populate credentials (password:{' '}
              <code className="font-mono-num font-semibold text-[var(--text-primary)]">
                Khorak@2026
              </code>
              ).
            </p>

            <div className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.username}
                  type="button"
                  onClick={() => {
                    setUsername(acc.username);
                    setPassword('Khorak@2026');
                    setError(null);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                    username === acc.username
                      ? 'border-[var(--accent)] bg-[var(--accent-subtle)] font-bold text-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--bg-sunken)]/50 hover:bg-[var(--bg-sunken)]'
                  }`}
                >
                  <span>{acc.label}</span>
                  <span className="font-mono-num text-[11px] opacity-75">{acc.username}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

