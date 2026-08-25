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
  return (
    <div className="grid grid-cols-[60px_1fr_60px] items-center px-4 pb-2.5 pt-3.5">
      <div />
      <div className="text-center">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--skc-text-primary)]">{workspace ? 'Call controls' : 'Dialer'}</h2>
        <button onClick={onReconnect} className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-[var(--skc-separator)] bg-[var(--skc-surface-3)] px-2 py-0.5 transition-colors hover:bg-[var(--skc-surface-2)]" title="Click to reconnect">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass} ${reconnecting ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] font-medium tracking-[-0.01em] text-[var(--skc-text-tertiary)]">{status}</span>
        </button>
      </div>
      {workspace ? <div aria-hidden="true" /> : <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center justify-self-end rounded-full bg-[var(--skc-surface-3)] text-[var(--skc-text-tertiary)] transition-colors hover:bg-[var(--skc-surface-2)] hover:text-white" aria-label="Close dialer" title="Close dialer"><Icon name="close" size="text-[16px]" /></button>}
    </div>
  )
}
