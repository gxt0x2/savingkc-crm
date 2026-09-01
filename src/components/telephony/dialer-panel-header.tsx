'use client'

import { Icon } from '@/components/ui/icon'

type DialerPanelHeaderProps = {
  workspace: boolean
  status: string
  statusDotClass: string
  reconnecting: boolean
  onReconnect: () => void
  onClose: () => void
}
export function DialerPanelHeader({ workspace, status, statusDotClass, reconnecting, onReconnect, onClose }: DialerPanelHeaderProps) {
  if (workspace) {
    return (
      <header className="flex items-center justify-between gap-3 border-b border-[var(--skc-separator)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--skc-text-tertiary)]">Prospecting phone</p>
          <p className="mt-0.5 truncate text-sm font-black text-[var(--skc-text-primary)]">Call controls</p>
        </div>
        <button onClick={onReconnect} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--skc-separator)] bg-[var(--skc-surface-3)] px-3 text-[11px] font-bold text-[var(--skc-text-secondary)] transition-colors hover:bg-[var(--skc-surface-2)]" title="Reconnect the phone">
          <span className={`h-2 w-2 rounded-full ${statusDotClass} ${reconnecting ? 'animate-pulse' : ''}`} />
          <span>{status}</span>
        </button>
      </header>
    )
  }

  return (
    <div className="grid grid-cols-[60px_1fr_60px] items-center px-4 pb-2.5 pt-3.5">
      <div />
      <div className="text-center">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--skc-text-primary)]">Dialer</h2>
        <button onClick={onReconnect} className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-[var(--skc-separator)] bg-[var(--skc-surface-3)] px-2 py-0.5 transition-colors hover:bg-[var(--skc-surface-2)]" title="Click to reconnect">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass} ${reconnecting ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] font-medium tracking-[-0.01em] text-[var(--skc-text-tertiary)]">{status}</span>
        </button>
      </div>
      <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center justify-self-end rounded-full bg-[var(--skc-surface-3)] text-[var(--skc-text-tertiary)] transition-colors hover:bg-[var(--skc-surface-2)] hover:text-white" aria-label="Close dialer" title="Close dialer"><Icon name="close" size="text-[16px]" /></button>
    </div>
  )
}
