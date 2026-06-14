export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { parkLead } from '@/lib/hot-engine'
import { triageLead, type TriageResult } from '@/lib/lead-triage'
import { deadReasonLabel } from '@/lib/lead-outcomes'
import type { ManifestV2 } from '@/lib/manifest-builder'

/**
 * POST /api/admin/triage-all
 *
 * Walks every active acquisition lead, runs lead-triage classifier, returns
 * a verdict per lead. Dry-run by default.
 *
 * Body (all optional):
 *   {
 *     "apply": false,            // false = dry-run. true = park / mark dead.
 *     "verdicts": ["dead","park"], // restrict apply to these verdicts
 *     "leadIds": ["id", ...],    // restrict scan to these lead ids
 *     "limit": 1000,             // cap scanned rows
 *   }
 *
 * Auth: Bearer ADMIN_API_SECRET / CRON_SECRET (or signed-in admin)
 */

interface TriageFinding {
  leadId: string
  fullName: string | null
  phone: string | null
  station: string | null
  verdict: TriageResult['verdict']
  reason: string
  rationale: string
  parkUntilDays?: number
  motivationScore: number | null
  lastCallDurationSec: number | null
  lastDisposition: string | null
  transcriptSummary: string
  applied?: boolean
  applyError?: string
}

interface LeadRow {
  id: string
  full_name: string | null
  phone: string | null
  station: string | null
  is_parked: boolean | null
}

interface ManifestRow {
  lead_id: string
  manifest: ManifestV2
  created_at: string
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  let body: {
    apply?: boolean
    verdicts?: Array<'dead' | 'park'>
    leadIds?: string[]
    limit?: number
  } = {}
  try {
    body = await req.json()
  } catch {
    // empty body OK
  }

  const apply = body.apply === true
  const allowedVerdicts = new Set(body.verdicts ?? ['dead', 'park'])
  const limit = Math.min(body.limit ?? 1000, 2000)
  const db = supabaseAdmin()

  // ── 1. Load leads ─────────────────────────────────────────────────────
  let leadsQuery = db
    .from('leads')
    .select('id, full_name, phone, station, is_parked')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (body.leadIds && body.leadIds.length > 0) {
    leadsQuery = db
      .from('leads')
      .select('id, full_name, phone, station, is_parked')
      .in('id', body.leadIds.slice(0, 2000))
  }

  const { data: leads, error: leadsErr } = await leadsQuery
  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })
  const leadRows = (leads ?? []) as LeadRow[]
  if (leadRows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, findings: [], applied: 0 })
  }

  // ── 2. Load latest manifest per lead ───────────────────────────────────
  const leadIds = leadRows.map((l) => l.id)
  const { data: manifests, error: manErr } = await db
    .from('manifests')
    .select('lead_id, manifest, created_at')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false })

  if (manErr) return NextResponse.json({ error: manErr.message }, { status: 500 })

  const manifestByLead = new Map<string, ManifestV2>()
  for (const row of (manifests ?? []) as ManifestRow[]) {
    if (!manifestByLead.has(row.lead_id)) {
      manifestByLead.set(row.lead_id, row.manifest)
    }
  }

  // ── 3. Classify ────────────────────────────────────────────────────────
  const findings: TriageFinding[] = []
  for (const lead of leadRows) {
    const manifest = manifestByLead.get(lead.id)
    if (!manifest) continue
    const result = triageLead(manifest)
    findings.push({
      leadId: lead.id,
      fullName: lead.full_name,
      phone: lead.phone,
      station: lead.station,
      verdict: result.verdict,
      reason: result.reason,
      rationale: result.rationale,
      parkUntilDays: result.parkUntilDays,
      motivationScore: result.motivationScore,
      lastCallDurationSec: result.lastCallDurationSec,
      lastDisposition: result.lastDisposition,
      transcriptSummary: result.transcriptSummary,
    })
  }

  // ── 4. Apply if requested ──────────────────────────────────────────────
  let appliedCount = 0
  if (apply) {
    for (const f of findings) {
      if (f.verdict === 'keep') continue
      if (!allowedVerdicts.has(f.verdict)) continue
      try {
        if (f.verdict === 'dead') {
          const deadReason = 'system_triage'
          const now = new Date().toISOString()
          const { error: updErr } = await db
            .from('leads')
            .update({
              station: 'dead',
              priority: 'cold',
              classification: 'dead',
              opportunity_score: 0,
              dead_reason: deadReason,
              dead_at: now,
              dead_by: 'system:lead_triage',
              updated_at: now,
            })
            .eq('id', f.leadId)
          if (updErr) {
            f.applied = false
            f.applyError = updErr.message
            continue
          }
          await updateManifestAndCascade(f.leadId, (manifest) => {
            manifest.currentStation = 'dead'
            manifest.auditTrail = manifest.auditTrail ?? []
            manifest.auditTrail.push({
              timestamp: now,
              agent: 'system:lead_triage',
              action: 'marked_dead',
              details: {
                reason: f.reason,
                rationale: f.rationale,
                dead_reason: deadReason,
                dead_reason_label: deadReasonLabel(deadReason),
              },
            })
          }, 'lead_triage').catch(() => false)
        } else if (f.verdict === 'park') {
          const reviveAt = f.parkUntilDays
            ? new Date(Date.now() + f.parkUntilDays * 24 * 60 * 60 * 1000)
            : undefined
          await parkLead(f.leadId, f.reason, reviveAt)
        }
        f.applied = true
        appliedCount++
      } catch (err) {
        f.applied = false
        f.applyError = err instanceof Error ? err.message : String(err)
      }
    }
  }

  const summary = {
    byVerdict: {
      keep: findings.filter((f) => f.verdict === 'keep').length,
      park: findings.filter((f) => f.verdict === 'park').length,
      dead: findings.filter((f) => f.verdict === 'dead').length,
    },
    byReason: findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.reason] = (acc[f.reason] ?? 0) + 1
      return acc
    }, {}),
  }

  return NextResponse.json({
    ok: true,
    dryRun: !apply,
    scanned: findings.length,
    applied: appliedCount,
    summary,
    findings,
  })
}
