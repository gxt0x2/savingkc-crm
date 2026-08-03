'use client'

import { Icon } from '@/components/ui/icon'

export function GlobalDialerButton({ compact = false }: { compact?: boolean }) {
  function openDialer() {
    window.dispatchEvent(new Event('open-global-dialer'))
  }

  return (
    <button
      type="button"
      onClick={openDialer}
      aria-label="Open phone dialer"
      title="Open phone dialer"
      className={`crm-primary-button grid shrink-0 place-items-center rounded-lg ${compact ? 'h-9 w-9' : 'h-10 w-10'}`}
    >
      <Icon name="call" className={compact ? 'text-[18px]' : 'text-[20px]'} />
    </button>
  )
}
