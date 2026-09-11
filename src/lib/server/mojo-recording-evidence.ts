import 'server-only'

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCallAnalysisLeadProposal } from '@/lib/server/ai-change-proposals'
import { analyzeCallTranscript, type CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'
import type { MojoCallIngestResult, MojoCallRecord } from '@/lib/server/mojo-call-import'

export const MOJO_RECORDING_BUCKET = 'mojo-call-recordings'

type EvidenceResult = {
  status: 'skipped' | 'already_analyzed' | 'analyzed'
  storagePath: string | null
  summary: string | null
}

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function insertEvidenceActivity(input: {
  id: string
  leadId: string
  createdAt: string
  description: string
  metadata: Record<string, unknown>
}) {
  const db = supabaseAdmin()
  const { error } = await db.from('lead_activities').upsert({
    id: input.id,
    lead_id: input.leadId,
    activity_type: 'note',
    description: input.description,
    agent: 'AI',
    metadata: input.metadata,
    created_at: input.createdAt,
  }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw new Error(`mojo_evidence_write_failed:${error.message}`)
}

async function localRecordingFile(input: {
  eventId: string
  sourceUrl: string
  storagePath: string | null
}): Promise<{ filePath: string; storagePath: string }> {
  const db = supabaseAdmin()
  const targetStoragePath = input.storagePath || `events/${input.eventId}.mp3`

  if (input.storagePath) {
    const { data, error } = await db.storage.from(MOJO_RECORDING_BUCKET).download(input.storagePath)
    if (!error && data) {
      const directory = join(tmpdir(), 'savingkc-recordings')
      await mkdir(directory, { recursive: true })
      const filePath = join(directory, `mojo-${input.eventId}.mp3`)
      await writeFile(filePath, Buffer.from(await data.arrayBuffer()))
      return { filePath, storagePath: input.storagePath }
    }
  }

  const filePath = await downloadRecording(input.sourceUrl, input.eventId)
  const audio = await readFile(filePath)
  const { error: uploadError } = await db.storage.from(MOJO_RECORDING_BUCKET).upload(
    targetStoragePath,
    audio,
    { contentType: 'audio/mpeg', cacheControl: '3600', upsert: true },
  )
  if (uploadError) throw new Error(`mojo_recording_copy_failed:${uploadError.message}`)
  return { filePath, storagePath: targetStoragePath }
}

async function existingTranscript(leadId: string, activityId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('lead_activities')
    .select('metadata')
    .eq('id', activityId)
    .eq('lead_id', leadId)
    .maybeSingle()
  if (error) throw new Error(`mojo_transcript_lookup_failed:${error.message}`)
  return text(metadata(data?.metadata).fullTranscript) || null
}

async function existingAnalysis(leadId: string, activityId: string): Promise<CallAnalysisResult | null> {
  const { data, error } = await supabaseAdmin()
    .from('lead_activities')
    .select('metadata')
    .eq('id', activityId)
    .eq('lead_id', leadId)
    .maybeSingle()
  if (error) throw new Error(`mojo_analysis_lookup_failed:${error.message}`)
  const analysis = metadata(metadata(data?.metadata).analysis)
  return Object.keys(analysis).length > 0 ? analysis as CallAnalysisResult : null
}

async function updateCallActivity(input: {
  activityId: string | null
  eventId: string
  storagePath: string
  duration: number
}) {
  if (!input.activityId) return
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('lead_activities')
    .select('metadata')
    .eq('id', input.activityId)
    .maybeSingle()
  if (error) throw new Error(`mojo_call_activity_lookup_failed:${error.message}`)
  const { error: updateError } = await db
    .from('lead_activities')
    .update({
      metadata: {
        ...metadata(data?.metadata),
        recordingUrl: `/api/recordings/mojo/${input.eventId}`,
        recordingDuration: input.duration,
        recording_storage_path: input.storagePath,
        recordingProcessingState: 'completed',
      },
    })
    .eq('id', input.activityId)
  if (updateError) throw new Error(`mojo_call_activity_update_failed:${updateError.message}`)
}

export async function processMojoRecordingEvidence(
  result: MojoCallIngestResult,
  call: MojoCallRecord,
): Promise<EvidenceResult> {
  if (!result.leadId || !result.promotionEligible || !call.recording_url) {
    return { status: 'skipped', storagePath: null, summary: null }
  }

  const db = supabaseAdmin()
  const { data: event, error: eventError } = await db
    .from('crm_mojo_call_events')
    .select('recording_storage_path,recording_processing_status')
    .eq('id', result.eventId)
    .maybeSingle()
  if (eventError) throw new Error(`mojo_recording_event_lookup_failed:${eventError.message}`)
  if (event?.recording_processing_status === 'analyzed') {
    return {
      status: 'already_analyzed',
      storagePath: text(event.recording_storage_path) || null,
      summary: null,
    }
  }

  const { error: processingError } = await db.from('crm_mojo_call_events').update({
    recording_processing_status: 'processing',
    recording_processing_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', result.eventId)
  if (processingError) throw new Error(`mojo_recording_processing_claim_failed:${processingError.message}`)

  let filePath: string | null = null
  try {
    const local = await localRecordingFile({
      eventId: result.eventId,
      sourceUrl: call.recording_url,
      storagePath: text(event?.recording_storage_path) || null,
    })
    filePath = local.filePath
    const copiedAt = new Date().toISOString()
    const { error: copyStateError } = await db.from('crm_mojo_call_events').update({
      recording_storage_path: local.storagePath,
      recording_processing_status: 'copied',
      recording_processing_error: null,
      recording_copied_at: copiedAt,
      updated_at: copiedAt,
    }).eq('id', result.eventId)
    if (copyStateError) throw new Error(`mojo_recording_copy_state_failed:${copyStateError.message}`)
    await updateCallActivity({
      activityId: result.activityId,
      eventId: result.eventId,
      storagePath: local.storagePath,
      duration: call.call_duration,
    })

    const transcriptActivityId = stableWebhookActivityId('mojo-transcript', result.eventId)
    const analysisActivityId = stableWebhookActivityId('mojo-analysis', result.eventId)
    let transcript = await existingTranscript(result.leadId, transcriptActivityId)
    if (!transcript) {
      transcript = await transcribeAudio(filePath)
      if (!transcript || transcript.length < 10) throw new Error('mojo_transcript_too_short')
      await insertEvidenceActivity({
        id: transcriptActivityId,
        leadId: result.leadId,
        createdAt: result.callAt,
        description: `Mojo call transcript: ${transcript.slice(0, 500)}${transcript.length > 500 ? '...' : ''}`,
        metadata: {
          source: 'whisper_transcription',
          provider: 'mojo',
          event_id: result.eventId,
          record_id: call.record_id,
          provider_recording_id: call.provider_recording_id,
          recordingUrl: `/api/recordings/mojo/${result.eventId}`,
          recording_storage_path: local.storagePath,
          duration_seconds: call.call_duration,
          fullTranscript: transcript,
        },
      })
    }

    let analysis = await existingAnalysis(result.leadId, analysisActivityId)
    if (!analysis) {
      analysis = await analyzeCallTranscript(transcript, { referenceDate: result.callAt })
      if (!analysis) throw new Error('mojo_analysis_unavailable')
      const summary = text(analysis.aiSummary) || text(analysis.summary) || 'Analysis complete'
      await insertEvidenceActivity({
        id: analysisActivityId,
        leadId: result.leadId,
        createdAt: result.callAt,
        description: `AI Call Summary: ${summary}`,
        metadata: {
          source: 'call_analysis',
          provider: 'mojo',
          event_id: result.eventId,
          record_id: call.record_id,
          provider_recording_id: call.provider_recording_id,
          recordingUrl: `/api/recordings/mojo/${result.eventId}`,
          recording_storage_path: local.storagePath,
          duration_seconds: call.call_duration,
          analysis,
        },
      })
    }

    await createCallAnalysisLeadProposal({
      leadId: result.leadId,
      clientAttemptId: null,
      recordingSid: `mojo:${result.eventId}`,
      analysis,
    })
    const processedAt = new Date().toISOString()
    const { error: completionError } = await db.from('crm_mojo_call_events').update({
      recording_storage_path: local.storagePath,
      recording_processing_status: 'analyzed',
      recording_processing_error: null,
      recording_analyzed_at: processedAt,
      updated_at: processedAt,
    }).eq('id', result.eventId)
    if (completionError) throw new Error(`mojo_recording_completion_failed:${completionError.message}`)

    return {
      status: 'analyzed',
      storagePath: local.storagePath,
      summary: text(analysis.aiSummary) || text(analysis.summary) || null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.from('crm_mojo_call_events').update({
      recording_processing_status: 'failed',
      recording_processing_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('id', result.eventId)
    throw error
  } finally {
    if (filePath) await unlink(filePath).catch(() => undefined)
  }
}
