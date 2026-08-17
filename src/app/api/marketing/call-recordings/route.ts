import { after, NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail, isCurrentUserAdmin } from '@/lib/auth/admin'
import { formatPhone } from '@/lib/format'
import { isInternalTestPhone } from '@/lib/internal-test-phones'
import { cleanDeadReason } from '@/lib/lead-outcomes'
import { CALL_REVIEWERS, isCallReviewer } from '@/lib/call-review-reviewers'
import { CALL_REVIEW_TAGS, getCallReviewFramework } from '@/lib/call-review-frameworks'
import { scoreCallReview } from '@/lib/call-review-scoring'
import { processCallReviewAi } from '@/lib/call-review-ai'
import { buildRecordingSummary, compactTranscript, isGoogleAdsCall, isRecordingReviewOutcome, mergeRecordingReviewMetadata, mergeCallReviewWorkflow, playableRecordingUrl, readRecordingDuration, readRecordingReview, readCallReviewWorkflow, readRecordingSid, record, text, type RecordingReviewOutcome } from '@/lib/marketing/call-recordings'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

type LeadActivityRow = {
  id: string
  lead_id: string | null
  activity_type: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
  agent: string | null
}

type LeadRow = {
  id: string
  full_name: string | null
  phone: string | null
  source: string | null
  station: string | null
  priority: string | null
  property_address: string | null
  city: string | null
  state: string | null
  classification: string | null
  opportunity_score: number | null
  created_at: string | null
  updated_at: string | null
  call_duration_seconds: number | null
}

type CallRecordingItem = {
  id: string
  leadId: string | null
  leadName: string
  leadPhone: string | null
  leadPhoneDisplay: string | null
  leadUrl: string | null
  leadSource: string | null
  leadStation: string | null
  leadPriority: string | null
  propertyAddress: string | null
  city: string | null
  state: string | null
  classification: string | null
  opportunityScore: number | null
  recordingSid: string
  recordingUrl: string
  callSid: string | null
  direction: string | null
  from: string | null
  to: string | null
  fromDisplay: string | null
  toDisplay: string | null
  durationSeconds: number
  createdAt: string
  campaign: string | null
  trafficSource: string | null
  trackingNumber: string | null
  phoneProfile: string | null
  isGoogleAds: boolean
  outcome: string
  reviewNote: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  transcript: string | null
  transcriptActivityId: string | null
  analysisSummary: string | null
  reviewWorkflow: ReturnType<typeof readCallReviewWorkflow>
}

function previewTestReview(): CallRecordingItem {
  return {
    id: 'test-review-preview',
    leadId: null,
    leadName: 'TEST REVIEW — Jordan Seller',
    leadPhone: null,
    leadPhoneDisplay: '(816) 555-0100',
    leadUrl: null,
    leadSource: 'preview_test',
    leadStation: 'qualified',
    leadPriority: 'high',
    propertyAddress: '123 Test Property',
    city: 'Kansas City',
    state: 'MO',
    classification: 'opportunity',
    opportunityScore: 72,
    recordingSid: 'TEST-REVIEW',
    recordingUrl: '/audio/ivr-voicemail.mp3',
    callSid: null,
    direction: 'outbound',
    from: null,
    to: null,
    fromDisplay: null,
    toDisplay: '(816) 555-0100',
    durationSeconds: 74,
    createdAt: new Date().toISOString(),
    campaign: null,
    trafficSource: 'preview_test',
    trackingNumber: null,
    phoneProfile: 'Casey',
    isGoogleAds: false,
    outcome: 'unreviewed',
    reviewNote: null,
    reviewedAt: null,
    reviewedBy: null,
    transcript: 'This is a preview-only test review. Use it to submit a framework, complete the scorecard, and verify the workflow.',
    transcriptActivityId: null,
    analysisSummary: 'Test coaching opportunity: confirm motivation, timeline, decision makers, and a committed next step.',
    reviewWorkflow: {
      status: 'available',
      framework: null,
      submittedAt: null,
      submittedBy: null,
      assignedReviewer: null,
      submissionNote: null,
      completedAt: null,
      completedBy: null,
      score: null,
      criticalScore: null,
      needsCoaching: false,
      coachingReasons: [],
      scoringVersion: null,
      aiStatus: 'idle',
      aiProcessedAt: null,
      aiModel: null,
      aiError: null,
      aiScore: null,
      aiCriticalScore: null,
      aiAnswers: {},
      aiCorrections: [],
      answers: {},
      tags: [],
      reviewNote: null,
      voiceoverPath: null,
      voiceoverMimeType: null,
    },
  }
}

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function leadName(lead: LeadRow | undefined, from: string): string {
  return text(lead?.full_name) || (from ? `Caller ${formatPhone(from) || from}` : 'Unknown caller')
}

function callNumberDisplay(value: string | null | undefined): string | null {
  const cleaned = text(value)
  if (!cleaned) return null
  return formatPhone(cleaned) || cleaned
}

function isInternalTestRecording(metadata: unknown): boolean {
  const meta = record(metadata)
  return meta.is_test === true || isInternalTestPhone(text(meta.from)) || isInternalTestPhone(text(meta.to)) || isInternalTestPhone(text(meta.calledNumber))
}

function findTranscriptFor(call: LeadActivityRow, transcriptRows: LeadActivityRow[]): { id: string; text: string } | null {
  const sid = readRecordingSid(call.metadata)
  const direct = transcriptRows.find((row) => readRecordingSid(row.metadata) === sid)
  if (direct) {
    const meta = record(direct.metadata)
    const full = compactTranscript(meta.fullTranscript)
    if (full) return { id: direct.id, text: full }
    return { id: direct.id, text: compactTranscript(direct.description || '') }
  }

  const callTime = Date.parse(call.created_at || '')
  if (!Number.isFinite(callTime)) return null
  const fallback = transcriptRows.find((row) => {
    if (row.lead_id !== call.lead_id) return false
    const rowTime = Date.parse(row.created_at || '')
    return Number.isFinite(rowTime) && Math.abs(rowTime - callTime) <= 45 * 60 * 1000
  })
  if (!fallback) return null
  const meta = record(fallback.metadata)
  return {
    id: fallback.id,
    text: compactTranscript(meta.fullTranscript, fallback.description || ''),
  }
}

function findAnalysisFor(call: LeadActivityRow, analysisRows: LeadActivityRow[]): string | null {
  const callTime = Date.parse(call.created_at || '')
  if (!Number.isFinite(callTime)) return null
  const row = analysisRows.find((item) => {
    if (item.lead_id !== call.lead_id) return false
    const rowTime = Date.parse(item.created_at || '')
    return Number.isFinite(rowTime) && rowTime >= callTime && rowTime - callTime <= 45 * 60 * 1000
  })
  if (!row) return null
  const analysis = record(record(row.metadata).analysis)
  return text(analysis.aiSummary) || text(analysis.summary) || compactTranscript(row.description || '') || null
}

function rowToItem(row: LeadActivityRow, leadById: Map<string, LeadRow>, transcriptRows: LeadActivityRow[], analysisRows: LeadActivityRow[]): CallRecordingItem | null {
  const meta = record(row.metadata)
  const recordingUrl = playableRecordingUrl(meta)
  const recordingSid = readRecordingSid(meta)
  const durationSeconds = readRecordingDuration(meta)
  if (!recordingUrl || !recordingSid || durationSeconds <= 0 || !row.created_at) return null

  const lead = row.lead_id ? leadById.get(row.lead_id) : undefined
  const review = readRecordingReview(meta)
  const from = text(meta.from) || null
  const to = text(meta.to) || text(meta.calledNumber) || null
  const transcript = findTranscriptFor(row, transcriptRows)

  return {
    id: row.id,
    leadId: row.lead_id,
    leadName: leadName(lead, from || ''),
    leadPhone: lead?.phone || null,
    leadPhoneDisplay: callNumberDisplay(lead?.phone),
    leadUrl: row.lead_id ? `/leads/${row.lead_id}` : null,
    leadSource: lead?.source || text(meta.lead_source) || text(meta.context_source) || null,
    leadStation: lead?.station || null,
    leadPriority: lead?.priority || null,
    propertyAddress: lead?.property_address || null,
    city: lead?.city || null,
    state: lead?.state || null,
    classification: lead?.classification || null,
    opportunityScore: lead?.opportunity_score ?? null,
    recordingSid,
    recordingUrl,
    callSid: text(meta.callSid) || null,
    direction: text(meta.direction) || null,
    from,
    to,
    fromDisplay: callNumberDisplay(from),
    toDisplay: callNumberDisplay(to),
    durationSeconds,
    createdAt: row.created_at,
    campaign: text(meta.campaign) || null,
    trafficSource: text(meta.traffic_source) || null,
    trackingNumber: text(meta.tracking_number) || null,
    phoneProfile: text(meta.phone_profile) || null,
    isGoogleAds: isGoogleAdsCall(meta),
    outcome: review.outcome,
    reviewNote: review.note,
    reviewedAt: review.reviewedAt,
    reviewedBy: review.reviewedBy,
    transcript: transcript?.text || null,
    transcriptActivityId: transcript?.id || null,
    analysisSummary: findAnalysisFor(row, analysisRows),
    reviewWorkflow: readCallReviewWorkflow(meta),
  }
}

export async function GET(req: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const params = req.nextUrl.searchParams
  const days = parsePositiveInt(params.get('days'), 30, 1, 365)
  const minDuration = parsePositiveInt(params.get('minDuration'), 120, 5, 3600)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const db = supabaseAdmin()

  const { data: callRows, error: callError } = await db.from('lead_activities').select('id, lead_id, activity_type, description, metadata, created_at, agent').eq('activity_type', 'call').gte('created_at', since).order('created_at', { ascending: false }).limit(1500)

  if (callError) {
    return NextResponse.json({ error: callError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const candidateCalls = ((callRows || []) as LeadActivityRow[]).filter((row) => {
    const meta = record(row.metadata)
    if (isInternalTestRecording(meta)) return false
    return Boolean(playableRecordingUrl(meta) && readRecordingDuration(meta) >= minDuration)
  })
  const leadIds = Array.from(new Set(candidateCalls.map((row) => row.lead_id).filter((id): id is string => Boolean(id))))

  let leadRows: LeadRow[] = []
  if (leadIds.length) {
    const { data, error } = await db.from('leads').select('id, full_name, phone, source, station, priority, property_address, city, state, classification, opportunity_score, created_at, updated_at, call_duration_seconds').in('id', leadIds)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    }
    leadRows = (data || []) as LeadRow[]
  }

  let noteRows: LeadActivityRow[] = []
  if (leadIds.length) {
    const { data, error } = await db.from('lead_activities').select('id, lead_id, activity_type, description, metadata, created_at, agent').eq('activity_type', 'note').in('lead_id', leadIds).gte('created_at', since).order('created_at', { ascending: false }).limit(2500)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    }
    noteRows = (data || []) as LeadActivityRow[]
  }

  const transcriptRows = noteRows.filter((row) => text(record(row.metadata).source) === 'whisper_transcription')
  const analysisRows = noteRows.filter((row) => text(record(row.metadata).source) === 'call_analysis')
  const leadById = new Map(leadRows.map((lead) => [lead.id, lead]))
  const recordings = candidateCalls.map((row) => rowToItem(row, leadById, transcriptRows, analysisRows)).filter((row): row is CallRecordingItem => Boolean(row))
  if (process.env.VERCEL_ENV === 'preview') recordings.unshift(previewTestReview())

  const summary = buildRecordingSummary(
    recordings.map((item) => ({
      durationSeconds: item.durationSeconds,
      outcome: item.outcome as ReturnType<typeof readRecordingReview>['outcome'],
      isGoogleAds: item.isGoogleAds,
    })),
  )

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      viewerEmail: email,
      reviewers: CALL_REVIEWERS,
      filters: { days, minDuration, since },
      summary,
      recordings,
    },
    { headers: NO_STORE_HEADERS },
  )
}

export async function PATCH(req: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const body = (await req.json().catch(() => null)) as {
    activityId?: unknown
    recordingSid?: unknown
    action?: unknown
    outcome?: unknown
    note?: unknown
    framework?: unknown
    answers?: unknown
    tags?: unknown
    assignedReviewer?: unknown
    voiceoverPath?: unknown
    voiceoverMimeType?: unknown
  } | null
  const activityId = text(body?.activityId)
  const recordingSid = text(body?.recordingSid)
  const action = text(body?.action)
  const outcome = text(body?.outcome)
  const note = text(body?.note)
  if ((!activityId && !recordingSid) || (!['submit', 'complete', 'retry_ai'].includes(action) && !isRecordingReviewOutcome(outcome))) {
    return NextResponse.json({ error: 'Invalid review payload' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const db = supabaseAdmin()
  let activityQuery = db.from('lead_activities').select('id, lead_id, activity_type, description, metadata, created_at, agent').eq('activity_type', 'call').limit(1)
  activityQuery = activityId ? activityQuery.eq('id', activityId) : activityQuery.eq('metadata->>recordingSid', recordingSid)
  const { data: activity, error: activityError } = await activityQuery.maybeSingle()

  if (activityError) {
    return NextResponse.json({ error: activityError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }
  if (!activity) {
    return NextResponse.json({ error: 'Recording activity not found' }, { status: 404, headers: NO_STORE_HEADERS })
  }

  const now = new Date().toISOString()
  const activityRow = activity as LeadActivityRow

  if (action === 'retry_ai') {
    const existing = readCallReviewWorkflow(activityRow.metadata)
    if (existing.status !== 'submitted') {
      return NextResponse.json({ error: 'Only submitted calls can be rescored' }, { status: 409, headers: NO_STORE_HEADERS })
    }
    if (existing.assignedReviewer !== email && !(await isCurrentUserAdmin())) {
      return NextResponse.json({ error: 'This review is assigned to another reviewer' }, { status: 403, headers: NO_STORE_HEADERS })
    }
    const updatedMetadata = mergeCallReviewWorkflow(activityRow.metadata, {
      aiStatus: 'processing',
      aiProcessedAt: null,
      aiError: null,
    })
    const { error: updateError } = await db.from('lead_activities').update({ metadata: updatedMetadata }).eq('id', activityRow.id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500, headers: NO_STORE_HEADERS })
    }
    after(() => processCallReviewAi(activityRow.id))
    return NextResponse.json(
      {
        ok: true,
        activityId: activityRow.id,
        action,
        workflow: readCallReviewWorkflow(updatedMetadata),
      },
      { headers: NO_STORE_HEADERS },
    )
  }

  if (action === 'submit' || action === 'complete') {
    const framework = getCallReviewFramework(body?.framework)
    if (!framework) return NextResponse.json({ error: 'Select a valid review framework' }, { status: 400, headers: NO_STORE_HEADERS })
    const existing = readCallReviewWorkflow(activityRow.metadata)
    let updatedMetadata: Record<string, unknown>
    let description: string
    if (action === 'submit') {
      const assignedReviewer = text(body?.assignedReviewer).toLowerCase()
      if (!isCallReviewer(assignedReviewer)) return NextResponse.json({ error: 'Select a valid reviewer' }, { status: 400, headers: NO_STORE_HEADERS })
      const allowedTags = new Set<string>(CALL_REVIEW_TAGS)
      const tags = Array.isArray(body?.tags) ? body.tags.map(text).filter((tag) => allowedTags.has(tag)) : []
      updatedMetadata = mergeCallReviewWorkflow(activityRow.metadata, {
        status: 'submitted',
        framework: framework.id,
        submittedAt: now,
        submittedBy: email,
        assignedReviewer,
        tags,
        submissionNote: note,
        aiStatus: 'processing',
        aiProcessedAt: null,
        aiError: null,
        aiScore: null,
        aiCriticalScore: null,
        aiAnswers: {},
        aiCorrections: [],
      })
      const reviewerName = CALL_REVIEWERS.find((reviewer) => reviewer.email === assignedReviewer)?.name || assignedReviewer
      description = `Call submitted to ${reviewerName} for review — ${framework.label}`
    } else {
      if (existing.status !== 'submitted') return NextResponse.json({ error: 'Submit the call before completing its review' }, { status: 409, headers: NO_STORE_HEADERS })
      if (existing.assignedReviewer !== email && !(await isCurrentUserAdmin())) {
        return NextResponse.json({ error: 'This review is assigned to another reviewer' }, { status: 403, headers: NO_STORE_HEADERS })
      }
      const supplied = record(body?.answers)
      const itemIds = framework.sections.flatMap((section) => section.items.map((item) => item.id))
      const answers = Object.fromEntries(
        itemIds.map((id) => {
          const value = Number(supplied[id])
          return [id, Number.isFinite(value) ? Math.min(3, Math.max(0, Math.round(value))) : 0]
        }),
      )
      const scoring = scoreCallReview(framework, answers)
      const aiCorrections = Object.entries(existing.aiAnswers).flatMap(([id, assessment]) => (assessment.score === answers[id] ? [] : [id]))
      const voiceoverPath = text(body?.voiceoverPath)
      const voiceoverMimeType = text(body?.voiceoverMimeType)
      if (voiceoverPath && !voiceoverPath.startsWith(`call-review-voiceovers/${activityRow.id}/`)) {
        return NextResponse.json({ error: 'Invalid coaching voiceover attachment' }, { status: 400, headers: NO_STORE_HEADERS })
      }
      updatedMetadata = mergeCallReviewWorkflow(activityRow.metadata, {
        status: 'completed',
        framework: framework.id,
        completedAt: now,
        completedBy: email,
        score: scoring.score,
        criticalScore: scoring.criticalScore,
        needsCoaching: scoring.needsCoaching,
        coachingReasons: scoring.coachingReasons,
        scoringVersion: scoring.scoringVersion,
        aiCorrections,
        answers,
        reviewNote: note,
        voiceoverPath: voiceoverPath || null,
        voiceoverMimeType: voiceoverMimeType || null,
      })
      description = `Scorecard completed — ${framework.label}: ${scoring.score}/3${scoring.needsCoaching ? ' — Needs Coaching' : ''}`
    }
    const resolvedActivityId = activityRow.id
    const { error: workflowUpdateError } = await db.from('lead_activities').update({ metadata: updatedMetadata }).eq('id', resolvedActivityId)
    if (workflowUpdateError) return NextResponse.json({ error: workflowUpdateError.message }, { status: 500, headers: NO_STORE_HEADERS })
    if (action === 'submit') after(() => processCallReviewAi(resolvedActivityId))
    if (activityRow.lead_id) {
      await db.from('lead_activities').insert({
        lead_id: activityRow.lead_id,
        activity_type: 'note',
        description: `${description}${note ? ` — ${note}` : ''}`,
        agent: email,
        metadata: {
          source: 'call_review_workflow',
          call_activity_id: resolvedActivityId,
          action,
          framework: framework.id,
          assigned_reviewer: readCallReviewWorkflow(updatedMetadata).assignedReviewer,
        },
      })
    }
    return NextResponse.json(
      {
        ok: true,
        activityId: resolvedActivityId,
        action,
        workflow: readCallReviewWorkflow(updatedMetadata),
      },
      { headers: NO_STORE_HEADERS },
    )
  }

  const typedOutcome = outcome as RecordingReviewOutcome
  const updatedMetadata = mergeRecordingReviewMetadata((activity as LeadActivityRow).metadata, {
    outcome: typedOutcome,
    note,
    reviewedAt: now,
    reviewedBy: email,
  })

  const { error: updateError } = await db.from('lead_activities').update({ metadata: updatedMetadata }).eq('id', activityId)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  if (activityRow.lead_id) {
    const label = typedOutcome.replace(/_/g, ' ')
    const { error: noteError } = await db.from('lead_activities').insert({
      lead_id: activityRow.lead_id,
      activity_type: 'note',
      description: `Call recording reviewed: ${label}${note ? ` — ${note}` : ''}`,
      agent: email,
      metadata: {
        source: 'marketing_call_recording_review',
        call_activity_id: activityId,
        recordingSid: readRecordingSid(updatedMetadata) || null,
        outcome: typedOutcome,
      },
    })
    if (noteError) {
      return NextResponse.json({ error: noteError.message }, { status: 500, headers: NO_STORE_HEADERS })
    }

    if (typedOutcome === 'spam' || typedOutcome === 'wrong_number') {
      const deadReason = cleanDeadReason(typedOutcome) ?? 'other'
      const { error: leadUpdateError } = await db
        .from('leads')
        .update({
          station: 'dead',
          priority: 'cold',
          classification: 'dead',
          opportunity_score: 0,
          dead_reason: deadReason,
          dead_at: now,
          dead_by: email,
          updated_at: now,
        })
        .eq('id', activityRow.lead_id)
      if (leadUpdateError) {
        return NextResponse.json({ error: leadUpdateError.message }, { status: 500, headers: NO_STORE_HEADERS })
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      activityId,
      outcome: typedOutcome,
      reviewedAt: now,
      reviewedBy: email,
    },
    { headers: NO_STORE_HEADERS },
  )
}
