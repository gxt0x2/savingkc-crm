'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const FeedbackForm = dynamic(
  () => import('@/components/feedback/feedback-form').then((module) => module.FeedbackForm),
  { ssr: false },
)

const ROUTE_SECTIONS: Array<[string, string]> = [
  ['/reports', 'Reports'],
  ['/dashboard', 'Dashboard'],
  ['/contacts', 'Contacts'],
  ['/leads', 'Lead details'],
  ['/conversations', 'Conversations'],
  ['/dialer', 'Dialer'],
  ['/calendar', 'Calendar'],
  ['/tasks', 'Tasks'],
  ['/dispo', 'Dispositions / Closing'],
  ['/marketing', 'Google Ads'],
  ['/workflows', 'Workflows'],
  ['/ai', 'AI Assistant'],
  ['/settings', 'Settings'],
]

function sectionForPath(pathname: string) {
  return ROUTE_SECTIONS.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Other'
}

export function SystemAndon({ collapsed = false, floating = false }: { collapsed?: boolean; floating?: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const dismissTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current)
  }, [])

  function handleSubmit() {
    setSubmitted(true)
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current)
    dismissTimer.current = window.setTimeout(() => setSubmitted(false), 4000)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Raise an Andon and report an issue"
        title={collapsed ? 'Raise Andon' : undefined}
        className={cn(
          'group flex min-h-11 items-center rounded-lg border border-[var(--crm-danger)] bg-[var(--crm-danger-soft)] text-left text-[var(--crm-danger)] shadow-sm transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--crm-danger)_14%,var(--crm-surface))] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-danger)] focus-visible:ring-offset-2',
          collapsed ? 'mx-auto w-11 justify-center' : 'w-full gap-3 px-3 py-2.5',
          floating && 'fixed bottom-5 left-5 z-40 w-auto min-w-[150px]',
        )}
      >
        <Icon name="warning_amber" className="shrink-0 text-[21px]" />
        {collapsed ? null : <span className="min-w-0"><strong className="block text-[11px] font-black uppercase tracking-[0.08em]">Andon Cord</strong><span className="block text-[10px] font-semibold text-[var(--crm-text-muted)]">Report an issue</span></span>}
      </button>

      {open ? <FeedbackForm defaultSection={sectionForPath(pathname)} onClose={() => setOpen(false)} onSubmit={handleSubmit} /> : null}
      {submitted ? <div role="status" className="fixed bottom-5 right-5 z-[110] flex items-center gap-2 rounded-xl bg-[var(--crm-success)] px-4 py-3 text-sm font-bold text-white shadow-xl"><Icon name="check_circle" />Andon received</div> : null}
    </>
  )
}
