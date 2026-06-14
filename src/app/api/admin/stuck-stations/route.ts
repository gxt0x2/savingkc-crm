export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { deadReasonLabel } from '@/lib/lead-outcomes'
import { normalizeDealStage, type DealStage } from '@/types/pipeline'

/**
 * POST /api/admin/stuck-stations
 *
 * Scans every lead's manifest and flags rows whose `station` lags behind what
 * the manifest data actually shows. Example: manifest has an active appointment
 * but station is still `qualified`. These mismatches keep leads out of Hot Opps
 * and break the canonical-pipeline scoring formula.
 *
 * Body (all optional):
 *   {
 *     "apply": false,          // false = dry-run (default). true = PATCH each lead.
 *     "leadIds": ["id", ...],  // restrict scan to these leads
 *     "limit": 500,            // cap scanned rows (default 500, max 1000)
 *   }
 *
 * Response:
 *   {
 *     "ok": true,
 *     "scanned": 261,
 *     "stuck": [
 *       { "leadId": "...", "fullName": "...", "currentStation": "qualified",
 *         "proposedStation": "appointment_set", "severity": "high",
 *         "reasons": ["..."], "applied": true|false }
 *     ],
 *     "applied": 12
 *   }
 */

const HARD_NO_DISPOSITIONS = new Set([
  'wrong_number', 'wrong-number', 'wrongnumber',
  'dnc', 'do_not_call', 'donotcall',
  'not_interested', 'notinterested',
  'bad_number', 'bad-number',
  'deceased', 'deceased_no_alt',
  'spam', 'test',
])

const CONTRACT_FLAGS = new Set([
  'under_contract', 'contract_signed', 'contract', 'in_closing', 'closing',
])

const OFFER_FLAGS = new Set([
  'offer_made', 'offer_presented', 'offer_sent', 'offer',
])

const STAGE_RANK: Record<DealStage, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  appointment_set: 3,
  offer_made: 4,
  under_contract: 5,
  closed_won: 6,
  closed_lost: 6,
  dead: 6,
}

interface StuckFinding {
  leadId: string
  fullName: string | null
  currentStation: string | null
  proposedStation: DealStage
  severity: 'high' | 'medium'
  reasons: string[]
  applied?: boolean
  applyError?: string
}

interface LeadRow {
  id: string
  full_name: string | null
  station: string | null
}

interface ManifestRow {
  lead_id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manifest: any
  created_at: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyStuck(lead: LeadRow, manifest: any): StuckFinding | null {
  const currentStation = lead.station
  const currentStage = normalizeDealStage(currentStation)
  const currentRank = currentStage ? STAGE_RANK[currentStage] : -1

  const fullName = lead.full_name
  const reasons: string[] = []

  if (!manifest || typeof manifest !== 'object') return null

  // ── Rule 1: contract evidence → under_contract ────────────────────────
  const closing = manifest.closing ?? {}
  const opportunityFlags: string[] = Array.isArray(manifest.flags?.opportunityFlags)
    ? manifest.flags.opportunityFlags
    : []
  const pipelineContract = manifest.pipeline?.contract
  const contractStageCompleted = pipelineContract?.completed === true || pipelineContract?.completedAt
  const hasContractFlag = opportunityFlags.some((f) => CONTRACT_FLAGS.has(String(f).toLowerCase()))

  if (
    (closing.tc_file_id || closing.title_company || closing.file_number || contractStageCompleted || hasContractFlag) &&
    currentStage !== 'under_contract' &&
    currentStage !== 'closed_won'
  ) {
    if (closing.tc_file_id) reasons.push(`closing.tc_file_id=${closing.tc_file_id}`)
    if (closing.title_company) reasons.push(`title=${closing.title_company}`)
    if (closing.file_number) reasons.push(`file#=${closing.file_number}`)
    if (contractStageCompleted) reasons.push('pipeline.contract.completed')
    if (hasContractFlag) reasons.push('opportunityFlag includes contract')
    return {
      leadId: lead.id,
      fullName,
      currentStation,
      proposedStation: 'under_contract',
      severity: 'high',
      reasons,
    }
  }

  // ── Rule 2: hard-no disposition → dead ─────────────────────────────────
  const lastDispositionRaw: string | undefined = manifest.communications?.lastDisposition
  const lastDisposition = typeof lastDispositionRaw === 'string'
    ? lastDispositionRaw.toLowerCase().replace(/\s+/g, '_')
    : null

  if (
    lastDisposition &&
    HARD_NO_DISPOSITIONS.has(lastDisposition) &&
    currentStage !== 'dead' &&
    currentStage !== 'closed_lost'
  ) {
    return {
      leadId: lead.id,
      fullName,
      currentStation,
      proposedStation: 'dead',
      severity: 'high',
      reasons: [`lastDisposition=${lastDispositionRaw}`],
    }
  }

  // ── Rule 3: active appointment with real future date → appointment_set ──
  // Important: the manifest builder sometimes hallucinates an appointment
  // status of "scheduled" with prose like "Not specified" in scheduledAt.
  // Only promote when scheduledAt parses as an ISO datetime and is in the
  // near future (or within the last 24h, since the call might have just
  // ended).
  const appt = manifest.pipeline?.appointment
  if (appt && typeof appt === 'object') {
    const status = String(appt.status ?? '').toLowerCase()
    const activeStatuses = new Set(['scheduled', 'confirmed', 'reconfirmed'])
    if (activeStatuses.has(status)) {
      const rawScheduledAt = appt.scheduledAt
      const isIsoLike = typeof rawScheduledAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawScheduledAt)
      const scheduledAt = isIsoLike ? new Date(rawScheduledAt) : null
      const parsed = scheduledAt && !isNaN(scheduledAt.getTime()) ? scheduledAt : null
      const isUpcoming = parsed !== null && parsed.getTime() > Date.now() - 24 * 60 * 60 * 1000

      if (isUpcoming && currentRank < STAGE_RANK.appointment_set) {
        return {
          leadId: lead.id,
          fullName,
          currentStation,
          proposedStation: 'appointment_set',
          severity: 'high',
          reasons: [
            `pipeline.appointment.status=${status}`,
            `scheduledAt=${rawScheduledAt}`,
          ],
        }
      }
    }
  }

  // ── Rule 4: offer evidence → offer_made ────────────────────────────────
  const ourMaxOffer = manifest.financials?.our_max_offer ?? manifest.financials?.ourMaxOffer
  const sellerAsking = manifest.financials?.seller_asking_price ?? manifest.financials?.sellerAskingPrice
  const hasOfferFlag = opportunityFlags.some((f) => OFFER_FLAGS.has(String(f).toLowerCase()))
  const pipelineOffer = manifest.pipeline?.offer
  const offerStageCompleted = pipelineOffer?.completed === true || pipelineOffer?.completedAt

  if (
    (ourMaxOffer || hasOfferFlag || offerStageCompleted) &&
    currentRank < STAGE_RANK.offer_made &&
    currentStage !== 'dead'
  ) {
    if (ourMaxOffer) reasons.push(`our_max_offer=${ourMaxOffer}`)
    if (sellerAsking) reasons.push(`seller_asking=${sellerAsking}`)
    if (hasOfferFlag) reasons.push('opportunityFlag includes offer')
    if (offerStageCompleted) reasons.push('pipeline.offer.completed')
    return {
      leadId: lead.id,
      fullName,
      currentStation,
      proposedStation: 'offer_made',
      severity: 'high',
      reasons,
    }
  }

  // ── Rule 5: motivated + contacted → qualified ──────────────────────────
  const motivationScore: number | undefined = manifest.situation?.motivation?.score
  const lastSellerContactDate = manifest.communications?.lastSellerContactDate
  const lastInboundDate = manifest.communications?.lastInboundDate

  if (
    typeof motivationScore === 'number' &&
    motivationScore >= 6 &&
    (lastSellerContactDate || lastInboundDate) &&
    currentRank < STAGE_RANK.qualified &&
    currentStage !== 'dead'
  ) {
    return {
      leadId: lead.id,
      fullName,
      currentStation,
      proposedStation: 'qualified',
      severity: 'medium',
      reasons: [
        `motivation.score=${motivationScore}`,
        lastSellerContactDate ? `lastSellerContact=${lastSellerContactDate}` : `lastInbound=${lastInboundDate}`,
      ],
    }
  }

  // ── Rule 6: any seller contact → contacted ─────────────────────────────
  if (
    (lastSellerContactDate || lastInboundDate) &&
    currentStage === 'new'
  ) {
    return {
      leadId: lead.id,
      fullName,
      currentStation,
      proposedStation: 'contacted',
      severity: 'medium',
      reasons: [
        lastSellerContactDate ? `lastSellerContact=${lastSellerContactDate}` : `lastInbound=${lastInboundDate}`,
      ],
    }
  }

  return null
}

function deadReasonForFinding(finding: StuckFinding): string {
  const evidence = finding.reasons.join(' ').toLowerCase()
  if (evidence.includes('spam') || evidence.includes('test')) return 'spam'
  if (evidence.includes('wrong_number') || evidence.includes('bad_number')) return 'wrong_number'
  if (evidence.includes('dnc') || evidence.includes('do_not_call')) return 'dnc'
  if (evidence.includes('not_interested')) return 'not_selling'
  return 'system_triage'
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  let body: { apply?: boolean; leadIds?: string[]; limit?: number } = {}
  try {
    body = await req.json()
  } catch {
    // empty body OK
  }

  const apply = body.apply === true
  const limit = Math.min(body.limit ?? 500, 1000)
  const db = supabaseAdmin()

  // ── 1. Load lead rows ──────────────────────────────────────────────────
  let leadsQuery = db
    .from('leads')
    .select('id, full_name, station')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (body.leadIds && body.leadIds.length > 0) {
    leadsQuery = db
      .from('leads')
      .select('id, full_name, station')
      .in('id', body.leadIds.slice(0, 1000))
  }

  const { data: leads, error: leadsErr } = await leadsQuery
  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })
  const leadRows = (leads ?? []) as LeadRow[]
  if (leadRows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, stuck: [], applied: 0 })
  }

  // ── 2. Load latest manifest per lead ───────────────────────────────────
  const leadIds = leadRows.map((l) => l.id)
  const { data: manifests, error: manErr } = await db
    .from('manifests')
    .select('lead_id, manifest, created_at')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false })

  if (manErr) return NextResponse.json({ error: manErr.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manifestByLead = new Map<string, any>()
  for (const row of (manifests ?? []) as ManifestRow[]) {
    if (!manifestByLead.has(row.lead_id)) {
      manifestByLead.set(row.lead_id, row.manifest)
    }
  }

  // ── 3. Classify ────────────────────────────────────────────────────────
  const stuck: StuckFinding[] = []
  for (const lead of leadRows) {
    const manifest = manifestByLead.get(lead.id)
    const finding = classifyStuck(lead, manifest)
    if (finding) stuck.push(finding)
  }

  // ── 4. Apply (if requested) ────────────────────────────────────────────
  let appliedCount = 0
  if (apply) {
    for (const finding of stuck) {
      try {
        const now = new Date().toISOString()
        const deadReason = finding.proposedStation === 'dead' ? deadReasonForFinding(finding) : null
        const { error: updErr } = await db
          .from('leads')
          .update({
            station: finding.proposedStation,
            updated_at: now,
            ...(deadReason
              ? {
                priority: 'cold',
                classification: 'dead',
                opportunity_score: 0,
                dead_reason: deadReason,
                dead_at: now,
                dead_by: 'system:stuck_stations_detector',
              }
              : {}),
          })
          .eq('id', finding.leadId)
        if (updErr) {
          finding.applied = false
          finding.applyError = updErr.message
          continue
        }
        await updateManifestAndCascade(finding.leadId, (manifest) => {
          manifest.currentStation = finding.proposedStation
          manifest.auditTrail = manifest.auditTrail ?? []
          manifest.auditTrail.push({
            timestamp: now,
            agent: 'system:stuck_stations_detector',
            action: 'station_changed_admin',
            details: {
              from: finding.currentStation,
              to: finding.proposedStation,
              reason: 'stuck-station detector',
              evidence: finding.reasons,
              dead_reason: deadReason,
              dead_reason_label: deadReason ? deadReasonLabel(deadReason) : null,
            },
          })
        }, 'stuck_stations_detector').catch(() => false)
        finding.applied = true
        appliedCount++
      } catch (err) {
        finding.applied = false
        finding.applyError = err instanceof Error ? err.message : String(err)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: !apply,
    scanned: leadRows.length,
    stuck,
    applied: appliedCount,
    summary: {
      bySeverity: {
        high: stuck.filter((s) => s.severity === 'high').length,
        medium: stuck.filter((s) => s.severity === 'medium').length,
      },
      byProposed: stuck.reduce<Record<string, number>>((acc, s) => {
        acc[s.proposedStation] = (acc[s.proposedStation] ?? 0) + 1
        return acc
      }, {}),
    },
  })
}
