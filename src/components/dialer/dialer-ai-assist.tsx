'use client'

import Link from 'next/link'
import { AriBriefing } from '@/components/leads/ari-briefing'
import { NextAction } from '@/components/leads/next-action'
import { Icon } from '@/components/ui/icon'

interface DialerAiAssistProps {
  lead: { id: string; full_name: string | null; phone: string | null; email: string | null }
  activities: Array<{
    id: string
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }>
}
export function DialerAiAssist({ lead, activities }: DialerAiAssistProps) {
  return (
    <section aria-label="AI call assist" className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--crm-violet)]/25 bg-[var(--crm-violet-soft)] px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon name="auto_awesome" className="mt-0.5 shrink-0 text-lg text-[var(--crm-violet)]" />
          <div>
            <p className="text-xs font-black text-[var(--crm-ink)]">Ari call assist</p>
            <p className="mt-0.5 text-[11px] leading-5 text-[var(--crm-text-muted)]">Briefing and next-step drafts use the live contact history. Nothing is sent or saved automatically.</p>
          </div>
        </div>
        <Link href={`/leads/${lead.id}`} prefetch={false} className="shrink-0 text-[10px] font-black uppercase tracking-wider text-[var(--crm-violet)] hover:underline">Review profile</Link>
      </div>

      <AriBriefing leadId={lead.id} notes={null} sellerSituation={null} motivationScore={null} activities={activities} />
      <NextAction leadId={lead.id} leadName={lead.full_name} leadPhone={lead.phone} leadEmail={lead.email} activities={activities} />
    </section>
  )
}
