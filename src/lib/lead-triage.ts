/**
 * Lead Triage Classifier — pure function.
 *
 * Inspects a manifest and decides whether a lead belongs in Casey's
 * acquisition queue, in the parked review list, or terminated as dead.
 *
 * Verdicts map onto the canonical pipeline introduced by PR #121:
 *
 *   keep  → no change. Lead stays at its current station.
 *   park  → set leads.is_parked = true, write parked_reason, optional parked_until.
 *           Score drops to 0; surfaces on /parked.
 *   dead  → set leads.station = 'dead'. Surfaces only via archive search.
 *
 * The function does NOT touch the database. Callers apply the verdict via
 * parkLead() / updateManifestAndCascade() once a dry-run has been reviewed.
 *
 * Design rules:
 *   - Conservative default. Ambiguous leads stay (verdict = 'keep').
 *   - Strong keep signals beat ambiguous park signals.
 *   - Hard dispositions always win (DNC → dead even if motivation = 80).
 *   - No DB reads inside the classifier — it is pure on the manifest.
 */

import type { ManifestV2, TranscriptEntry } from './manifest-builder'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Outcomes that mean the conversation ended the lead. */
const HARD_NO_DISPOSITIONS = new Set([
  'wrong_number',
  'disconnected',
  'not_interested',
  'dnc',
  'do_not_call',
  'already_sold',
  'bad_number',
])

/** Outcomes that indicate no human contact was actually made. */
const NO_CONTACT_DISPOSITIONS = new Set([
  'no_answer',
  'voicemail_left',
  'voicemail',
  'left_voicemail',
  'busy',
])

/** Outcomes that prove the lead is real and engaged. */
const STRONG_KEEP_DISPOSITIONS = new Set([
  'interested',
  'meaningful_conversation',
  'appointment_set',
  'callback_scheduled',
])

/** Phone substrings that flag test / internal numbers. */
const TEST_PHONE_PATTERNS = [
  '+1555',         // 555 area / NANP reserved
  '+15555555',     // common placeholder
  '+10000000',     // null placeholder
  '+11111111',
]

/** Park revival windows (days). */
const PARK_DAYS = {
  noContactOnly: 14,
  lukewarmConversation: 90,
  somedayMaybe: 180,
} as const

// ─── Result Type ─────────────────────────────────────────────────────────────

export type TriageVerdict = 'keep' | 'park' | 'dead'

export interface TriageResult {
  verdict: TriageVerdict
  reason: string                  // machine-readable, snake_case
  rationale: string               // human-readable, one sentence
  parkUntilDays?: number          // present iff verdict === 'park'
  transcriptSummary: string       // for CSV review — empty if no transcript
  motivationScore: number | null  // best score across transcripts
  lastDisposition: string | null
  lastCallDurationSec: number | null
  signals: {
    appointment: boolean
    taxDelinquent3yr: boolean
    deceasedOwner: boolean
    outOfStateOwner: boolean
    hardDeadline: boolean
    foreclosureWindow: boolean
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeDisposition(raw: string | undefined | null): string {
  if (!raw) return ''
  return raw.toLowerCase().trim().replace(/\s+/g, '_').replace(/-/g, '_')
}

function getLatestTranscript(m: ManifestV2): TranscriptEntry | null {
  const t = m.communications?.transcripts
  if (!t || t.length === 0) return null
  return [...t].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
}

function getBestMotivationScore(m: ManifestV2): number | null {
  const fromSituation = m.situation?.motivation?.score
  let best = typeof fromSituation === 'number' ? fromSituation : null
  for (const t of m.communications?.transcripts ?? []) {
    const s = t.extractedData?.motivationScore
    if (typeof s === 'number' && (best === null || s > best)) best = s
  }
  return best
}

function hasTestPhonePattern(m: ManifestV2): boolean {
  const phones = m.owner?.phones ?? []
  return phones.some(p => TEST_PHONE_PATTERNS.some(pat => p.startsWith(pat)))
}

function hasStrongAppointment(m: ManifestV2): boolean {
  const a = m.pipeline?.appointment
  if (!a) return false
  return a.status === 'scheduled' || a.status === 'confirmed' || a.status === 'reconfirmed'
}

function hasUrgencySignals(m: ManifestV2): {
  hardDeadline: boolean
  foreclosure: boolean
  highUrgency: boolean
} {
  const t = m.situation?.timeline
  return {
    hardDeadline: !!t?.hardDeadline,
    foreclosure: typeof t?.foreclosureWindowDays === 'number' && t.foreclosureWindowDays <= 60,
    highUrgency: t?.urgency === 'high' || t?.urgency === 'critical',
  }
}

function pickTranscriptSummary(m: ManifestV2): string {
  const t = getLatestTranscript(m)
  if (!t) return ''
  if (t.aiSummary) return t.aiSummary.slice(0, 500)
  if (t.agentNotes) return t.agentNotes.slice(0, 500)
  if (t.fullTranscript) return t.fullTranscript.slice(0, 500)
  return ''
}

// ─── Main classifier ─────────────────────────────────────────────────────────

export function triageLead(manifest: ManifestV2): TriageResult {
  const station = manifest.currentStation
  const flags = manifest.flags?.opportunityFlags ?? []
  const disposition = normalizeDisposition(manifest.communications?.lastDisposition)
  const motivation = getBestMotivationScore(manifest)
  const lastTranscript = getLatestTranscript(manifest)
  const lastDuration = lastTranscript?.duration ?? null
  const urgency = hasUrgencySignals(manifest)

  const signals = {
    appointment: hasStrongAppointment(manifest),
    taxDelinquent3yr: flags.includes('3yr_tax_delinquent'),
    deceasedOwner: flags.includes('deceased_owner'),
    outOfStateOwner: flags.includes('out_of_state_owner'),
    hardDeadline: urgency.hardDeadline,
    foreclosureWindow: urgency.foreclosure,
  }

  const baseFields = {
    transcriptSummary: pickTranscriptSummary(manifest),
    motivationScore: motivation,
    lastDisposition: manifest.communications?.lastDisposition ?? null,
    lastCallDurationSec: lastDuration,
    signals,
  }

  // ── Already terminal — leave alone ────────────────────────────────────────
  if (station === 'dead' || station === 'closed_won' || station === 'closed_lost') {
    return {
      ...baseFields,
      verdict: 'keep',
      reason: 'already_terminal',
      rationale: `Already at terminal station '${station}'.`,
    }
  }

  // ── In closing — never touch ──────────────────────────────────────────────
  if (station === 'under_contract') {
    return {
      ...baseFields,
      verdict: 'keep',
      reason: 'under_contract',
      rationale: 'Under contract — protected from triage.',
    }
  }

  // ── DEAD: test/spam phone ─────────────────────────────────────────────────
  if (hasTestPhonePattern(manifest)) {
    return {
      ...baseFields,
      verdict: 'dead',
      reason: 'test_phone',
      rationale: 'Phone matches test/placeholder pattern.',
    }
  }

  // ── DEAD: hard-no disposition ─────────────────────────────────────────────
  if (HARD_NO_DISPOSITIONS.has(disposition)) {
    return {
      ...baseFields,
      verdict: 'dead',
      reason: `disposition_${disposition}`,
      rationale: `Last disposition '${disposition}' is a hard no.`,
    }
  }

  // ── DEAD: short call with nothing in transcript ──────────────────────────
  if (
    lastTranscript &&
    lastDuration !== null &&
    lastDuration > 0 &&
    lastDuration < 30 &&
    !signals.appointment &&
    (motivation ?? 0) < 30 &&
    !STRONG_KEEP_DISPOSITIONS.has(disposition)
  ) {
    return {
      ...baseFields,
      verdict: 'dead',
      reason: 'short_call_no_signal',
      rationale: `Call < 30s with no engagement signal (motivation=${motivation ?? 'n/a'}).`,
    }
  }

  // ── KEEP: strong signals (evaluated before park to avoid mis-parking) ────
  if (signals.appointment) {
    return { ...baseFields, verdict: 'keep', reason: 'appointment_active', rationale: 'Active appointment booked.' }
  }
  if (STRONG_KEEP_DISPOSITIONS.has(disposition)) {
    return { ...baseFields, verdict: 'keep', reason: `disposition_${disposition}`, rationale: `Last disposition '${disposition}' is a keep signal.` }
  }
  if (motivation !== null && motivation >= 60) {
    return { ...baseFields, verdict: 'keep', reason: 'high_motivation', rationale: `Motivation score ${motivation} ≥ 60.` }
  }
  if (urgency.foreclosure || urgency.hardDeadline) {
    return { ...baseFields, verdict: 'keep', reason: 'urgency_present', rationale: 'Foreclosure window or hard deadline on file.' }
  }
  if (signals.taxDelinquent3yr && (motivation ?? 0) >= 30) {
    return { ...baseFields, verdict: 'keep', reason: 'tax_distress_with_engagement', rationale: '3yr tax delinquent + measurable engagement.' }
  }
  if (station && ['qualified', 'appointment_set', 'offer_made'].includes(station)) {
    return { ...baseFields, verdict: 'keep', reason: 'advanced_stage', rationale: `At advanced station '${station}'.` }
  }

  // ── PARK: never-answered, only voicemail/no-answer to date ───────────────
  if (
    NO_CONTACT_DISPOSITIONS.has(disposition) &&
    !lastTranscript?.fullTranscript &&
    (motivation === null || motivation < 30)
  ) {
    return {
      ...baseFields,
      verdict: 'park',
      reason: 'no_contact_only',
      rationale: `Only ${disposition.replace('_', ' ')} so far — park to re-attempt later.`,
      parkUntilDays: PARK_DAYS.noContactOnly,
    }
  }

  // ── PARK: long call, lukewarm — they answered but didn't engage ──────────
  if (
    lastDuration !== null &&
    lastDuration >= 60 &&
    motivation !== null &&
    motivation < 40 &&
    !STRONG_KEEP_DISPOSITIONS.has(disposition)
  ) {
    return {
      ...baseFields,
      verdict: 'park',
      reason: 'long_call_low_motivation',
      rationale: `Engaged ${lastDuration}s call but motivation only ${motivation}.`,
      parkUntilDays: PARK_DAYS.lukewarmConversation,
    }
  }

  // ── PARK: explicit "someday/maybe" — low urgency, no pain ───────────────
  const lowUrgency = manifest.situation?.timeline?.urgency === 'low'
  const noPain = !manifest.situation?.motivation?.primary &&
    (manifest.situation?.type ?? []).length === 0
  if (lowUrgency && noPain && (motivation === null || motivation < 50)) {
    return {
      ...baseFields,
      verdict: 'park',
      reason: 'someday_timeline',
      rationale: 'Low urgency timeline, no pain signal recorded.',
      parkUntilDays: PARK_DAYS.somedayMaybe,
    }
  }

  // ── Default: conservative KEEP ────────────────────────────────────────────
  return {
    ...baseFields,
    verdict: 'keep',
    reason: 'no_archive_signal',
    rationale: 'No clear park/dead signal — defaulting to keep.',
  }
}

// ─── CSV helper for the dry-run script ───────────────────────────────────────

export const TRIAGE_CSV_HEADER = [
  'lead_id',
  'full_name',
  'phone',
  'station',
  'is_parked',
  'verdict',
  'reason',
  'rationale',
  'park_until_days',
  'motivation_score',
  'last_call_duration_sec',
  'last_disposition',
  'signals',
  'transcript_summary',
].join(',')

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function triageToCsvRow(
  lead: { id: string; full_name?: string | null; phone?: string | null; station?: string | null; is_parked?: boolean | null },
  result: TriageResult,
): string {
  const signalsCompact = Object.entries(result.signals)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join('|')
  return [
    lead.id,
    lead.full_name ?? '',
    lead.phone ?? '',
    lead.station ?? '',
    lead.is_parked ? 'true' : 'false',
    result.verdict,
    result.reason,
    result.rationale,
    result.parkUntilDays ?? '',
    result.motivationScore ?? '',
    result.lastCallDurationSec ?? '',
    result.lastDisposition ?? '',
    signalsCompact,
    result.transcriptSummary,
  ].map(csvEscape).join(',')
}
