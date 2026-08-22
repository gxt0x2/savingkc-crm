import { Icon } from '@/components/ui/icon'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'

function dateLabel(value: string | null) {
  if (!value) return 'Nothing scheduled'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
    : 'Schedule unavailable'
}

export function CampaignDeliveryPulse({ campaign }: { campaign: ProspectingCampaignDetail }) {
  const working = campaign.operations.queued + campaign.operations.processing
  const headline = campaign.stats.failed > 0
    ? 'Delivery needs attention'
    : working > 0
      ? 'Campaign is moving'
      : campaign.status === 'active' ? 'Provider queue is caught up' : 'Delivery is paused'
  const metrics = [
    ['schedule_send', campaign.operations.queued, 'Queued'],
    ['progress_activity', campaign.operations.processing, 'In flight'],
    ['mark_chat_read', campaign.stats.delivered, 'Delivered'],
    ['error', campaign.stats.failed, 'Failed'],
  ] as const

  return <article className="crm-panel rounded-2xl p-5 sm:p-6" aria-label="Campaign delivery pulse">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="crm-eyebrow">Delivery pulse</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">{headline}</h2><p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Live server-owned action state—not an estimate from the browser.</p></div><div className="rounded-xl bg-[var(--crm-surface-subtle)] px-4 py-3 text-right"><p className="text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Next scheduled action</p><p className="mt-1 text-sm font-black text-[var(--crm-ink)]">{dateLabel(campaign.operations.nextActionAt)}</p></div></div>
    <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{metrics.map(([icon, value, label]) => <div key={label} className={`rounded-xl border p-4 ${label === 'Failed' && value > 0 ? 'border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]'}`}><div className="flex items-center justify-between"><span className="text-2xl font-black text-[var(--crm-ink)]">{value}</span><Icon name={icon} className={`text-xl ${label === 'Failed' && value > 0 ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-text-dim)]'}`} /></div><p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p></div>)}</div>
    <p className="mt-4 text-xs leading-5 text-[var(--crm-text-muted)]">{campaign.operations.lastSentAt ? `Last provider-accepted send: ${dateLabel(campaign.operations.lastSentAt)}.` : 'No provider-accepted sends have been recorded yet.'} Carrier delivery failures stop that contact&apos;s remaining cadence and stay visible here.</p>
  </article>
}
