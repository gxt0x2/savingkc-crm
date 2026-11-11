'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AttributionTouch, LeadAttribution } from '@/lib/attribution/lead-attribution'
import type { JourneyStep } from '@/lib/ppc/lead-journey'

function host(url?: string): string | undefined {
  if (!url) return undefined
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
function path(url?: string): string | undefined {
  if (!url) return undefined
  try { return new URL(url).pathname } catch { return url }
}
function when(v?: string): string | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT'
}
function touchLine(t?: AttributionTouch): string {
  if (!t) return '—'
  const sm = [t.source, t.medium].filter(Boolean).join(' / ')
  const parts = [
    sm || (t.referrer ? `referral: ${host(t.referrer)}` : 'direct'),
    t.campaign && `campaign ${t.campaign}`,
    (t.gclid || t.gbraid || t.wbraid) && 'Google Ads click',
    t.landing_page && `landed ${path(t.landing_page)}`,
  ].filter(Boolean)
  return parts.join(' · ')
}

const EVENT_LABELS: Record<string, string> = {
  page_view: 'Viewed',
  cta_click: 'Clicked',
  phone_click: 'Tapped call',
  form_in_view: 'Saw the form',
  scroll_depth: 'Scrolled',
  quiz_started: 'Started the quiz',
  quiz_qualified: 'Finished the quiz',
  form_step_completed: 'Form step',
  contact_started: 'Started contact info',
  form_started: 'Started the form',
  lead_submitted: 'Submitted',
  ppc_visit_started: 'Ad visit',
}

function sourceLabel(source: string | null): string | undefined {
  if (!source) return undefined
  return source.replace(/_/g, ' ')
}

function JourneyList({ steps }: { steps: JourneyStep[] }) {
  if (!steps.length) return null
  const source = steps.find((step) => step.source)?.source ?? null
  return (
    <div className="pt-2">
      <dt className="mb-1 text-sm text-muted-foreground">
        Journey ({steps.length} events{source ? ` · ${sourceLabel(source)}` : ''})
      </dt>
      <dd>
        <ol className="space-y-0.5 text-sm">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-40 shrink-0 text-muted-foreground">{when(step.at)}</span>
              <span className="min-w-0 break-words">
                {EVENT_LABELS[step.event] ?? step.event.replace(/_/g, ' ')}
                {step.detail ? ` — ${step.detail}` : ''}
                {step.page ? <span className="text-muted-foreground"> · {step.page}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </dd>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  )
}

export function PathToLeadPanel({ leadId }: { leadId: string }) {
  const [attr, setAttr] = useState<LeadAttribution | null | undefined>(undefined)
  const [journey, setJourney] = useState<JourneyStep[]>([])

  useEffect(() => {
    let alive = true
    createClient().from('leads').select('attribution').eq('id', leadId).maybeSingle()
      .then(({ data, error }) => { if (alive) setAttr(error ? null : ((data as { attribution?: LeadAttribution } | null)?.attribution ?? null)) })
    // Website + lander journey for this lead's session, any traffic source.
    fetch(`/api/leads/${leadId}/journey`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { journey?: JourneyStep[] } | null) => { if (alive && body?.journey) setJourney(body.journey) })
      .catch(() => {})
    return () => { alive = false }
  }, [leadId])

  if (attr === undefined) return null
  return (
    <section className="rounded-lg border p-4" aria-label="Path to lead">
      <h3 className="mb-3 text-sm font-semibold">Path to lead</h3>
      {!attr ? (
        journey.length ? <dl className="space-y-1.5"><JourneyList steps={journey} /></dl> : <p className="text-sm text-muted-foreground">No attribution recorded for this lead.</p>
      ) : (
        <dl className="space-y-1.5">
          <Row label="Lead source" value={attr.lead_source_type.replace(/_/g, ' ')} />
          <Row label="First visit" value={when(attr.first_visit_at)} />
          <Row label="First touch" value={attr.first_touch ? touchLine(attr.first_touch) : undefined} />
          <Row label="Last touch" value={attr.last_touch ? touchLine(attr.last_touch) : undefined} />
          <Row label="Form" value={attr.form ? [attr.form.source, attr.form.status].filter(Boolean).join(' · ') : undefined} />
          <Row label="Device" value={attr.device?.type} />
          <Row label="GA4 client ID" value={attr.ga_client_id} />
          <Row label="GA4 session" value={attr.ga_session_id} />
          <Row label="Tracking number" value={attr.phone?.tracking_number} />
          <Row label="Forwarded from" value={attr.phone?.forwarded_from} />
          <Row label="Dialer" value={attr.dialer ? [attr.dialer.provider, attr.dialer.campaign_id, attr.dialer.list_id].filter(Boolean).join(' · ') : undefined} />
          <Row label="Import batch" value={attr.import?.batch_id} />
          {attr.page_history?.length ? (
            <div className="pt-2">
              <dt className="mb-1 text-sm text-muted-foreground">Pages viewed ({attr.page_history.length})</dt>
              <dd>
                <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                  {attr.page_history.map((p, i) => <li key={i}>{p.path}{p.at ? <span className="text-muted-foreground"> · {when(p.at)}</span> : null}</li>)}
                </ol>
              </dd>
            </div>
          ) : null}
          <JourneyList steps={journey} />
          {attr.derived_from?.startsWith('backfill') ? (
            <p className="pt-2 text-xs text-muted-foreground">Backfilled from older records — partial.</p>
          ) : null}
        </dl>
      )}
    </section>
  )
}
