import { RefreshCw, CloudCheck, CloudOff } from 'lucide-react';
import { useI18n } from '../locales/translations';

export function LiveSyncStatus({ refreshing, lastUpdated, error, refresh }: {
  refreshing: boolean;
  lastUpdated: Date | null;
  error: string | null;
  refresh: () => Promise<void>;
}) {
  const { lang } = useI18n();
  const gu = lang === 'gu';
  return <div className={`live-sync ${error ? 'live-sync-error' : ''}`}>
    {error ? <CloudOff size={18} /> : <CloudCheck size={18} />}
    <div className="min-w-0 flex-1 text-sm">
      <span className="font-semibold">{error ? (gu ? 'ડેટા અપડેટ થયો નથી' : 'Data may be out of date') : (gu ? 'આપમેળે અપડેટ' : 'Automatic updates')}</span>
      <span className="ml-2 text-[var(--text-secondary)]">{lastUpdated ? `${gu ? 'છેલ્લી સિંક' : 'Last synced'} ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : (gu ? 'સર્વર સાથે જોડાઈ રહ્યું છે' : 'Connecting to the server')}</span>
      {error && <p className="mt-1 text-[var(--danger)]">{error}</p>}
    </div>
    <button type="button" className="k-btn-secondary shrink-0" onClick={() => void refresh()} disabled={refreshing} aria-label={gu ? 'તાજું કરો' : 'Refresh data'}>
      <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
      <span className="hidden sm:inline">{gu ? 'તાજું કરો' : 'Refresh'}</span>
    </button>
  </div>;
}
