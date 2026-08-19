import { supabase } from '@/lib/supabase-lazy'
import { isUniqueViolation, stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'

type JsonObject = Record<string, unknown>

type RecordingContext = {
  source?: string
  traffic_source?: string
  campaign?: string
  lead_source?: string
  tracking_number?: string
  landing_page?: string
  phone_profile?: string
}

type RecordingCallbackMeta = {
  callSid?: string
  direction?: 'inbound' | 'outbound'
  duration: number
  from?: string
  recordingSid: string
  recordingSourceUrl: string
  recordingStatus: string
  recordingUrl: string
  source: 'twilio_recording_callback'
  to?: string
  context_source?: string
  traffic_source?: string
  campaign?: string
  lead_source?: string
  tracking_number?: string
  landing_page?: string
  phone_profile?: string
  recordingProcessingState?: 'processing' | 'completed' | 'failed'
  recordingProcessingStartedAt?: string
  recordingProcessingCompletedAt?: string
  recordingProcessingFailedAt?: string
  recordingProcessingError?: string
}

export type RecordingProcessingClaim = {
  activityId: string
  metadata: RecordingCallbackMeta & JsonObject
  shouldProcess: boolean
  skipped?: 'duplicate_completed' | 'duplicate_in_progress'
}

const RECORDING_PROCESSING_LEASE_MS = 5 * 60 * 1000

function isFreshProcessingLease(metadata: JsonObject, now: number): boolean {
  if (metadata.recordingProcessingState !== 'processing') return false
  if (typeof metadata.recordingProcessingStartedAt !== 'string') return false
  const startedAt = Date.parse(metadata.recordingProcessingStartedAt)
  return Number.isFinite(startedAt) && startedAt > now - RECORDING_PROCESSING_LEASE_MS
}

export async function claimPlayableRecordingActivity({
  leadId,
  recordingSid,
  recordingUrl,
  callSid,
  duration,
  recordingStatus,
  from,
  to,
  context,
}: {
  leadId: string
  recordingSid: string
  recordingUrl: string
  callSid: string
  duration: number
  recordingStatus: string
  from: string
  to: string
  context?: RecordingContext
}): Promise<RecordingProcessingClaim> {
  const processingStartedAt = new Date().toISOString()
  const metadata: RecordingCallbackMeta = {
    callSid,
    direction: from?.startsWith('client:') ? 'outbound' : 'inbound',
    duration,
    from,
    recordingSid,
    recordingSourceUrl: recordingUrl,
    recordingStatus,
    recordingUrl: `/api/recordings/${recordingSid}`,
    source: 'twilio_recording_callback',
    to,
    ...(context?.source && { context_source: context.source }),
    ...(context?.traffic_source && { traffic_source: context.traffic_source }),
    ...(context?.campaign && { campaign: context.campaign }),
    ...(context?.lead_source && { lead_source: context.lead_source }),
    ...(context?.tracking_number && { tracking_number: context.tracking_number }),
    ...(context?.landing_page && { landing_page: context.landing_page }),
    ...(context?.phone_profile && { phone_profile: context.phone_profile }),
    recordingProcessingState: 'processing',
    recordingProcessingStartedAt: processingStartedAt,
  }

  const { data: existing, error: existingError } = await supabase
    .from('lead_activities')
    .select('id, metadata')
    .eq('lead_id', leadId)
    .eq('activity_type', 'call')
    .contains('metadata', { recordingSid })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError

  if (existing?.id) {
    const existingMetadata = (
      existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}
    ) as JsonObject

    if (existingMetadata.recordingProcessingState === 'completed') {
      return {
        activityId: existing.id,
        metadata: existingMetadata as RecordingCallbackMeta & JsonObject,
        shouldProcess: false,
        skipped: 'duplicate_completed',
      }
    }

    if (isFreshProcessingLease(existingMetadata, Date.now())) {
      return {
        activityId: existing.id,
        metadata: existingMetadata as RecordingCallbackMeta & JsonObject,
        shouldProcess: false,
        skipped: 'duplicate_in_progress',
      }
    }

    if (!existingMetadata.recordingProcessingState) {
      const { data: existingTranscript, error: transcriptLookupError } = await supabase
        .from('lead_activities')
        .select('id')
        .eq('lead_id', leadId)
        .eq('activity_type', 'note')
        .eq('metadata->>source', 'whisper_transcription')
        .eq('metadata->>recordingSid', recordingSid)
        .limit(1)
        .maybeSingle()

      if (transcriptLookupError) throw transcriptLookupError
      if (existingTranscript?.id) {
        const completedMetadata = {
          ...existingMetadata,
          ...metadata,
          recordingProcessingState: 'completed' as const,
          recordingProcessingCompletedAt: processingStartedAt,
        }
        const { error: completionError } = await supabase
          .from('lead_activities')
          .update({ metadata: completedMetadata })
          .eq('id', existing.id)
        if (completionError) throw completionError

        return {
          activityId: existing.id,
          metadata: completedMetadata,
          shouldProcess: false,
          skipped: 'duplicate_completed',
        }
      }
    }

    const claimedMetadata = {
      ...existingMetadata,
      ...metadata,
      recordingProcessingCompletedAt: undefined,
      recordingProcessingFailedAt: undefined,
      recordingProcessingError: undefined,
    }
    const { error: claimError } = await supabase
      .from('lead_activities')
      .update({ metadata: claimedMetadata })
      .eq('id', existing.id)
    if (claimError) throw claimError

    return { activityId: existing.id, metadata: claimedMetadata, shouldProcess: true }
  }

  const activityId = stableWebhookActivityId('twilio-recording', recordingSid)
  const { error: insertError } = await supabase.from('lead_activities').insert({
    id: activityId,
    lead_id: leadId,
    activity_type: 'call',
    description: 'Call recording available',
    agent: 'System',
    metadata,
  })

  if (isUniqueViolation(insertError)) {
    return {
      activityId,
      metadata,
      shouldProcess: false,
      skipped: 'duplicate_in_progress',
    }
  }
  if (insertError) throw insertError

  return { activityId, metadata, shouldProcess: true }
}

export async function markRecordingProcessing(
  claim: RecordingProcessingClaim,
  state: 'completed' | 'failed',
  error?: unknown,
) {
  const now = new Date().toISOString()
  const nextMetadata: RecordingCallbackMeta & JsonObject = {
    ...claim.metadata,
    recordingProcessingState: state,
    ...(state === 'completed'
      ? { recordingProcessingCompletedAt: now }
      : {
          recordingProcessingFailedAt: now,
          recordingProcessingError: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error || 'Unknown processing error').slice(0, 500),
        }),
  }
  const { error: updateError } = await supabase
    .from('lead_activities')
    .update({ metadata: nextMetadata })
    .eq('id', claim.activityId)
  if (updateError) throw updateError
}
