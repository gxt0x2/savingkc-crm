#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadMojoEnv } from './mojo-session-health.mjs'
import { assessMojoCallQualification } from '../src/lib/mojo-call-qualification.mjs'

loadMojoEnv()

type EventRow = {
  id: string
  record_id: string
  lead_id: string | null
  contact_name: string | null
  call_at: string
  duration_seconds: number
  disposition_raw: string
  outcome: string
  notes: string | null
  recording_url: string | null
  recording_storage_path?: string | null
  follow_up_at: string | null
  promotion_eligible?: boolean | null
  qualification_status?: string | null
  recording_processing_status?: string | null
  leads?: { station?: string | null; classification?: string | null } | null
}

type WaitingEvidenceRow = {
  record_id: string
  payload: Record<string, unknown>
  created_at: string
}

function cliNumber(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.trunc(value), 365)) : fallback
}

const days = cliNumber('--days', 30)
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('Supabase service credentials are required for the read-only audit')

const db = createClient(url, key, { auth: { persistSession: false } })
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
const [eventResponse, waitingResponse] = await Promise.all([
  db
    .from('crm_mojo_call_events')
    .select('id,record_id,lead_id,contact_name,call_at,duration_seconds,disposition_raw,outcome,notes,recording_url,recording_storage_path,follow_up_at,promotion_eligible,qualification_status,recording_processing_status,leads:lead_id(station,classification)')
    .gte('call_at', since)
    .order('call_at', { ascending: false })
    .limit(5000),
  db
    .from('mojo_call_queue')
    .select('record_id,payload,created_at')
    .eq('status', 'waiting_evidence')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000),
])
if (eventResponse.error) throw new Error(`Mojo qualification audit failed: ${eventResponse.error.message}`)
if (waitingResponse.error) throw new Error(`Mojo waiting-evidence audit failed: ${waitingResponse.error.message}`)

const events = (eventResponse.data || []) as unknown as EventRow[]
const rows = events.map((event) => {
  const assessment = assessMojoCallQualification({
    outcome: event.outcome,
    call_duration: event.duration_seconds,
    notes: event.notes,
    recording_url: event.recording_url,
    follow_up_date: event.follow_up_at,
    has_appointment: event.outcome === 'appointment_set',
  })
  const terminal = ['dead', 'closed_lost'].includes(event.leads?.station || '')
    || event.leads?.classification === 'dead'
  return {
    eventId: event.id,
    recordId: event.record_id,
    leadId: event.lead_id,
    contactName: event.contact_name,
    callAt: event.call_at,
    providerOutcome: event.outcome,
    durationSeconds: event.duration_seconds,
    assessment: assessment.status,
    reasons: assessment.reasons,
    currentlyLinkedToLead: Boolean(event.lead_id),
    terminal,
    recordingAvailable: Boolean(event.recording_storage_path || event.recording_url),
    recordingProcessingStatus: event.recording_processing_status || 'legacy_unknown',
  }
})

const promotionOutcomes = new Set(['callback_scheduled', 'meaningful_conversation', 'appointment_set'])
const waitingEvidence = (waitingResponse.data || []) as unknown as WaitingEvidenceRow[]
const report = {
  generatedAt: new Date().toISOString(),
  mode: 'dry_run_read_only',
  windowDays: days,
  totals: {
    events: rows.length,
    promotionCandidates: rows.filter((row) => promotionOutcomes.has(row.providerOutcome)).length,
    eligible: rows.filter((row) => row.assessment === 'eligible').length,
    evidencePending: rows.filter((row) => row.assessment === 'evidence_pending').length,
    waitingEvidence: waitingEvidence.length,
    likelyFalsePositiveLinks: rows.filter((row) => row.currentlyLinkedToLead && promotionOutcomes.has(row.providerOutcome) && row.assessment === 'ineligible').length,
    terminalReview: rows.filter((row) => row.terminal && promotionOutcomes.has(row.providerOutcome)).length,
    missingRecording: rows.filter((row) => promotionOutcomes.has(row.providerOutcome) && !row.recordingAvailable).length,
  },
  reviewRequired: [
    ...rows.filter((row) => (
      row.assessment === 'evidence_pending'
      || (row.currentlyLinkedToLead && promotionOutcomes.has(row.providerOutcome) && row.assessment === 'ineligible')
      || (row.terminal && promotionOutcomes.has(row.providerOutcome))
      || (promotionOutcomes.has(row.providerOutcome) && !row.recordingAvailable)
    )),
    ...waitingEvidence.map((row) => ({
      kind: 'waiting_evidence',
      recordId: row.record_id,
      contactName: typeof row.payload.contact_name === 'string' ? row.payload.contact_name : null,
      callAt: typeof row.payload.call_date === 'string' ? row.payload.call_date : row.created_at,
      assessment: 'evidence_pending',
      reasons: Array.isArray(row.payload.qualification_reasons) ? row.payload.qualification_reasons : [],
      currentlyLinkedToLead: false,
      terminal: false,
      recordingAvailable: Boolean(row.payload.recording_url),
      recordingProcessingStatus: 'waiting_evidence',
    })),
  ],
}

console.log(JSON.stringify(report, null, 2))
