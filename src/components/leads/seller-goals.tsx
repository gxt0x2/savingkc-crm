// Core Goals — the 2-5 things this seller is actually optimizing for.
// Pulls from the full manifest (motivation, timeline, price, condition,
// decision makers, competition) and ranks them by urgency/confidence.
// Re-runs whenever the manifest or activity log changes so the list
// stays current as new info comes in.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useCardCollapse } from '@/hooks/use-card-collapse'

interface SellerGoalsProps {
  leadId: string
  notes?: string | null
  sellerSituation?: string | null
  activities?: Array<{
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
  }>
}

type Priority = 'critical' | 'high' | 'nominal'

interface Goal {
  id: string
  icon: string
  title: string
  detail: string
  priority: Priority
  /** 0-100 — confidence the signal is real, drives priority bar fill */
  confidence: number
}

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'var(--ck-accent-bright)', bg: 'rgba(239,68,68,0.12)' },
  high:     { label: 'High',     color: 'var(--ck-warn)',         bg: 'rgba(245,158,11,0.12)' },
  nominal:  { label: 'Nominal',  color: 'var(--ck-text-muted)',   bg: 'var(--ck-surface-elev)' },
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

function analyzeGoals(manifest: any, props: SellerGoalsProps): Goal[] {
  const goals: Goal[] = []
  const m = manifest || {}
  const s = m.situation || {}
  const mot = s.motivation || {}
  const tl = s.timeline || {}
  const price = s.priceExpectations || {}
  const prop = m.property || {}
  const owner = m.owner || {}

  const noteBlob = [
    props.notes || '',
    props.sellerSituation || '',
    ...(props.activities || []).map((a) => a.description || ''),
  ]
    .join(' ')
    .toLowerCase()

  // ── Speed of sale / deadline ────────────────────────────────────────────
  const urgency = (mot.urgencyLevel || '').toString().toLowerCase()
  const flex = (tl.flexibility || '').toString().toLowerCase()
  const deadline = tl.sellerDeadline || tl.preferredClosing
  const hasForecast = urgency.includes('immediate') || urgency.includes('urgent') || urgency.includes('asap')
  const noTime = urgency.includes('no rush') || urgency.includes('not sure') || flex.includes('flexible')

  if (deadline || hasForecast) {
    goals.push({
      id: 'speed',
      icon: 'bolt',
      title: 'Close quickly',
      detail: deadline
        ? `Target: ${deadline}`
        : hasForecast
          ? 'Urgency: ASAP'
          : 'Moving fast is a priority',
      priority: hasForecast ? 'critical' : 'high',
      confidence: hasForecast ? 95 : deadline ? 80 : 55,
    })
  } else if (noTime) {
    goals.push({
      id: 'speed',
      icon: 'schedule',
      title: 'No rush',
      detail: 'Flexible on timing — work the relationship, not the clock',
      priority: 'nominal',
      confidence: 70,
    })
  }

  // ── Walkaway cash / price floor ─────────────────────────────────────────
  const floor = price.sellerFloor ?? price.minimumAcceptable
  const asking = price.sellerAsking ?? price.askingPrice
  if (floor) {
    goals.push({
      id: 'cash-floor',
      icon: 'payments',
      title: 'Walk away with cash',
      detail: `Floor: ${formatMoney(Number(floor))}${asking ? ` · asking ${formatMoney(Number(asking))}` : ''}`,
      priority: 'high',
      confidence: 90,
    })
  } else if (asking) {
    goals.push({
      id: 'asking-price',
      icon: 'sell',
      title: 'Hit asking price',
      detail: `Asking ${formatMoney(Number(asking))} — floor not stated yet`,
      priority: 'nominal',
      confidence: 65,
    })
  } else if (/walk away with|need.*to walk|gotta get|need \$|looking for \$/i.test(noteBlob)) {
    goals.push({
      id: 'cash-mention',
      icon: 'payments',
      title: 'Clarify walkaway number',
      detail: 'Seller mentioned cash needs — ask for the exact floor',
      priority: 'high',
      confidence: 55,
    })
  }

  // ── Get rid of a burden (condition / vacancy / debt) ────────────────────
  const condition = (prop.condition?.overall || '').toString().toLowerCase()
  const badCondition = condition.includes('poor') || condition.includes('uninhabitable') || condition.includes('fair')
  const vacant = !!prop.vacant
  const taxOwed = prop.taxCollector?.totalOwed ?? prop.taxCollector?.delinquentAmount
  if (badCondition || vacant || taxOwed) {
    const bits: string[] = []
    if (badCondition) bits.push(`condition: ${condition}`)
    if (vacant) bits.push('vacant')
    if (taxOwed) bits.push(`owes ${formatMoney(Number(taxOwed))} in taxes`)
    goals.push({
      id: 'offload-burden',
      icon: 'remove_circle',
      title: 'Offload the burden',
      detail: bits.join(' · '),
      priority: taxOwed ? 'critical' : 'high',
      confidence: 80,
    })
  }

  // ── Avoid a specific outcome (primary motivation) ───────────────────────
  if (mot.primary) {
    goals.push({
      id: 'primary-motivation',
      icon: 'flag',
      title: String(mot.primary),
      detail: mot.signals?.length ? `Signals: ${mot.signals.slice(0, 2).join('; ')}` : 'Primary reason for selling',
      priority: hasForecast ? 'critical' : 'high',
      confidence: 85,
    })
  }

  // ── Next place / relocation ─────────────────────────────────────────────
  const needsNext = /relocat|moving to|need.*(new|next) (place|home)|downsize|retirement/i.test(
    noteBlob + ' ' + (mot.primary || '')
  )
  if (needsNext) {
    goals.push({
      id: 'next-place',
      icon: 'home',
      title: 'Find the next place',
      detail: 'Seller needs a landing spot — help with it or lose the deal',
      priority: 'high',
      confidence: 70,
    })
  }

  // ── Clean exit / privacy (probate, divorce, inheritance) ────────────────
  const situationTypes: string[] = s.type || []
  const cleanExitSignals = situationTypes.some((t) =>
    ['inherited', 'probate', 'divorce', 'deceased_owner'].includes(t)
  )
  if (cleanExitSignals || owner.deceased) {
    const label = situationTypes.find((t) =>
      ['inherited', 'probate', 'divorce', 'deceased_owner'].includes(t)
    )
    goals.push({
      id: 'clean-exit',
      icon: 'shield',
      title: 'Clean, quiet exit',
      detail: label
        ? `${label.replace(/_/g, ' ')} — minimize friction, handle paperwork`
        : 'Minimize friction and emotional load',
      priority: 'high',
      confidence: 80,
    })
  }

  // ── Consensus (multiple decision makers) ────────────────────────────────
  const decisionMakers: string[] = owner.decisionMakers || owner.coOwners || []
  const mentionsOthers = /my (wife|husband|spouse|partner|sibling|mom|dad|son|daughter)|we own|both of us|our house|co-?owner/i.test(
    noteBlob
  )
  if (decisionMakers.length > 0 || mentionsOthers) {
    goals.push({
      id: 'consensus',
      icon: 'groups',
      title: 'Get everyone on board',
      detail:
        decisionMakers.length > 0
          ? `Decision makers: ${decisionMakers.join(', ')}`
          : 'Other people are part of the decision — surface them',
      priority: 'high',
      confidence: decisionMakers.length > 0 ? 85 : 60,
    })
  }

  // Rank + cap at 5
  const priorityRank: Record<Priority, number> = { critical: 0, high: 1, nominal: 2 }
  const dedup = new Map<string, Goal>()
  for (const g of goals) {
    if (!dedup.has(g.id)) dedup.set(g.id, g)
  }
  return [...dedup.values()]
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || b.confidence - a.confidence)
    .slice(0, 5)
}

export function SellerGoals(props: SellerGoalsProps) {
  const { leadId } = props
  const [manifest, setManifest] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [open, toggleOpen] = useCardCollapse('core-goals')

  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    function bump() { setRefreshTick((t) => t + 1) }
    window.addEventListener('crm:lead-refresh', bump)
    return () => window.removeEventListener('crm:lead-refresh', bump)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('manifests')
          .select('manifest, updated_at')
          .eq('lead_id', leadId)
          .limit(1)
          .maybeSingle()
        if (!cancelled) {
          setManifest(data?.manifest ?? null)
          if (data?.updated_at) setUpdatedAt(new Date(data.updated_at).getTime())
          else setUpdatedAt(Date.now())
        }
      } catch {
        if (!cancelled) setManifest(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (leadId) load()
    return () => { cancelled = true }
  }, [leadId, props.notes, props.sellerSituation, props.activities?.length, refreshTick])

  const goals = useMemo(() => analyzeGoals(manifest, props), [manifest, props])

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return null
    const diffMin = Math.floor((Date.now() - updatedAt) / 60_000)
    if (diffMin < 1) return 'updated just now'
    if (diffMin < 60) return `updated ${diffMin}m ago`
    const h = Math.floor(diffMin / 60)
    if (h < 24) return `updated ${h}h ago`
    return `updated ${Math.floor(h / 24)}d ago`
  }, [updatedAt])

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center justify-between mb-4"
      >
        <div className="flex items-center gap-2">
          <Icon name="flag" className="!text-base !text-[color:var(--ck-accent)]" />
          <h2 className="ck-microlabel !text-[11px] !text-white">Core Goals</h2>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--ck-success)', boxShadow: '0 0 6px rgba(16,185,129,0.6)' }}
            title="Live — updates as new manifest data arrives"
          />
        </div>
        <div className="flex items-center gap-2">
          {updatedLabel && (
            <span className="text-[9px]" style={{ color: 'var(--ck-text-dim)' }}>
              {updatedLabel}
            </span>
          )}
          <Icon
            name={open ? 'expand_less' : 'expand_more'}
            className="!text-base !text-[color:var(--ck-text-muted)]"
          />
        </div>
      </button>

      {!open ? null : loading ? (
        <div className="flex items-center gap-2 py-2">
          <div
            className="w-3 h-3 border-2 rounded-full animate-spin"
            style={{ borderColor: 'rgba(239,68,68,0.3)', borderTopColor: 'var(--ck-accent)' }}
          />
          <span className="text-xs" style={{ color: 'var(--ck-text-muted)' }}>Reading manifest…</span>
        </div>
      ) : goals.length === 0 ? (
        <div
          className="rounded-lg p-3 border border-dashed text-xs"
          style={{ borderColor: 'var(--ck-border)', color: 'var(--ck-text-muted)' }}
        >
          No goals extracted yet. Log a call or add notes about motivation, timeline, or price to populate.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {goals.map((goal) => {
            const cfg = PRIORITY_CONFIG[goal.priority]
            return (
              <li
                key={goal.id}
                className="rounded-xl p-3 border flex items-start gap-3 transition-colors"
                style={{
                  background: 'var(--ck-surface-elev)',
                  borderColor: 'var(--ck-border)',
                }}
              >
                <div
                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: cfg.bg, color: cfg.color }}
                >
                  <Icon name={goal.icon} className="!text-base" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold leading-tight" style={{ color: 'var(--ck-text)' }}>
                      {goal.title}
                    </p>
                    <span
                      className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: cfg.bg, color: cfg.color }}
                    >
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-[11px] leading-snug mt-1" style={{ color: 'var(--ck-text-muted)' }}>
                    {goal.detail}
                  </p>
                  {/* confidence bar — subtle, not a huge visual */}
                  <div
                    className="h-0.5 rounded-full overflow-hidden mt-2"
                    style={{ background: 'var(--ck-border)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${goal.confidence}%`,
                        background: cfg.color,
                        opacity: 0.6,
                      }}
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
