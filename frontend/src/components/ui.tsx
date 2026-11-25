import React, { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  RefreshCw,
  Wifi,
  X,
  XCircle,
} from 'lucide-react';
import { OutboxStatus } from '../types';
import { useI18n } from '../locales/translations';

export function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="khorak-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="modal-heading"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 id="modal-heading" className="text-lg font-bold text-[var(--text-primary)]">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-sunken)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="max-h-[78vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

export function StatusBadge({
  variant,
  children,
}: {
  variant: 'normal' | 'warning' | 'critical' | 'info' | 'neutral';
  children: React.ReactNode;
}) {
  const styles: Record<typeof variant, string> = {
    normal: 'bg-[var(--success-subtle)] text-[var(--success)] border-emerald-200',
    warning: 'bg-[var(--warning-subtle)] text-[var(--warning)] border-amber-300',
    critical: 'bg-[var(--danger-subtle)] text-[var(--danger)] border-red-200',
    info: 'bg-[var(--accent-subtle)] text-[var(--accent)] border-emerald-900/15',
    neutral: 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] border-[var(--border)]',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

export function OutboxStatusBadge({ status }: { status: OutboxStatus }) {
  const { t } = useI18n();
  switch (status) {
    case 'saved_locally':
      return <StatusBadge variant="info">{t('savedLocally')}</StatusBadge>;
    case 'pending_sync':
      return (
        <StatusBadge variant="warning">
          <RefreshCw className="h-3 w-3 animate-spin" />
          {t('pendingSync')}
        </StatusBadge>
      );
    case 'synced':
      return (
        <StatusBadge variant="normal">
          <CheckCircle2 className="h-3 w-3" />
          {t('synchronised')}
        </StatusBadge>
      );
    case 'conflict':
      return (
        <StatusBadge variant="warning">
          <AlertTriangle className="h-3 w-3" />
          Conflict
        </StatusBadge>
      );
    case 'failed':
      return (
        <StatusBadge variant="critical">
          <XCircle className="h-3 w-3" />
          {t('syncFailed')}
        </StatusBadge>
      );
  }
}

export function SyncStatusPill({
  isOnline,
  pendingCount,
  syncing,
  onSyncClick,
}: {
  isOnline: boolean;
  pendingCount: number;
  syncing?: boolean;
  onSyncClick?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
          isOnline
            ? 'border-emerald-200 bg-[var(--success-subtle)] text-[var(--success)]'
            : 'border-amber-300 bg-[var(--saffron-subtle)] text-[var(--warning)]'
        }`}
      >
        {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
        {isOnline ? t('online') : t('offline')}
      </span>

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={onSyncClick}
          disabled={!isOnline || syncing}
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-[var(--saffron-subtle)] px-3 py-1 text-xs font-semibold text-[var(--warning)] hover:bg-amber-100 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {pendingCount} {t('pendingSync')}
        </button>
      )}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'green' | 'saffron' | 'danger';
  icon?: React.ReactNode;
}) {
  const borderClass =
    tone === 'danger'
      ? 'border-red-200 bg-red-50/40'
      : tone === 'saffron'
        ? 'border-amber-200 bg-[var(--saffron-subtle)]/50'
        : tone === 'green'
          ? 'border-emerald-900/20 bg-[var(--accent-subtle)]/50'
          : 'border-[var(--border)] bg-[var(--bg-raised)]';

  return (
    <div className={`rounded-xl border p-4 ${borderClass}`}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-secondary)]">
        <span>{label}</span>
        {icon}
      </div>
      <div className="font-mono-num mt-1.5 text-2xl font-bold tracking-tight text-[var(--text-primary)]">
        {value}
      </div>
      {hint && <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-sunken)]/50 px-6 py-10 text-center">
      <p className="text-base font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 max-w-md text-sm text-[var(--text-secondary)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading content">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-shimmer h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

