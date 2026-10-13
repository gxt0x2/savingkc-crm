'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AttributionTouch, LeadAttribution } from '@/lib/attribution/lead-attribution'

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

  useEffect(() => {
    let alive = true
    createClient().from('leads').select('attribution').eq('id', leadId).maybeSingle()
      .then(({ data, error }) => { if (alive) setAttr(error ? null : ((data as { attribution?: LeadAttribution } | null)?.attribution ?? null)) })
    return () => { alive = false }
  }, [leadId])

  if (attr === undefined) return null
  return (
    <section className="rounded-lg border p-4" aria-label="Path to lead">
      <h3 className="mb-3 text-sm font-semibold">Path to lead</h3>
      {!attr ? (
        <p className="text-sm text-muted-foreground">No attribution recorded for this lead.</p>
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
          {attr.derived_from?.startsWith('backfill') ? (
            <p className="pt-2 text-xs text-muted-foreground">Backfilled from older records — partial.</p>
          ) : null}
        </dl>
      )}
    </section>
  )
}
