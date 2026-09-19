import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileActor } from '@/lib/mobile-api/auth'
import { completeMobileCommand, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { MobileAttachmentError, validateMobileMessageFile } from '@/lib/mobile-api/message-attachments'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id } = await params
    const key = req.headers.get('idempotency-key')?.trim() || ''
    if (!id || key.length < 8 || key.length > 200) {
      return NextResponse.json({ error: 'Lead id and a stable Idempotency-Key are required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const apiKey = process.env.GROQ_API_KEY?.trim()
    if (!apiKey) return NextResponse.json({ error: 'Voice transcription is not configured.' }, { status: 503, headers: mobileNoStoreHeaders() })
    const { data: lead, error: leadError } = await supabaseAdmin().from('leads').select('id').eq('id', id).maybeSingle()
    if (leadError) throw new MobileAttachmentError('The lead could not be verified.', 503)
    if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404, headers: mobileNoStoreHeaders() })
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new MobileAttachmentError('Choose a voice recording to transcribe.', 400)
    const { filename, mimeType } = validateMobileMessageFile(file)
    if (!mimeType.startsWith('audio/')) throw new MobileAttachmentError('Voice transcription requires an audio recording.', 415)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const payloadHash = createHash('sha256').update(id).update('\u0000').update(bytes).digest('hex')
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email,
      idempotencyKey: key,
      command: 'transcribe_voice_note',
      leadId: id,
      payloadHash,
    })
    if (reservation.kind === 'conflict') return NextResponse.json({ error: 'That Idempotency-Key belongs to a different recording.' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'pending') return NextResponse.json({ error: 'This recording is already being transcribed.', code: 'operation_pending' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'replay') return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })

    const providerForm = new FormData()
    providerForm.append('file', new File([bytes], filename, { type: mimeType }))
    providerForm.append('model', 'whisper-large-v3-turbo')
    providerForm.append('response_format', 'json')
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: providerForm,
      signal: AbortSignal.timeout(30_000),
    })
    const payload = await response.json().catch(() => null) as { text?: unknown; error?: { message?: string } } | null
    const text = typeof payload?.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim() : ''
    if (!response.ok || !text) {
      console.error('[mobile-transcription] provider rejected recording', { status: response.status, error: payload?.error?.message })
      const result = { error: 'The recording could not be transcribed. Your audio draft is still available.' }
      try {
        await completeMobileCommand({ actorEmail: actor.email, idempotencyKey: key, status: 502, result })
      } catch (receiptError) {
        console.error('[mobile-transcription] failure receipt completion failed:', receiptError)
        return NextResponse.json({
          ...result,
          warning: 'The failed attempt could not be reconciled. Keep the recording and refresh before retrying.',
        }, { status: 502, headers: mobileNoStoreHeaders() })
      }
      return NextResponse.json(result, { status: 502, headers: mobileNoStoreHeaders() })
    }
    const result = { success: true, text, provider: 'groq', model: 'whisper-large-v3-turbo' }
    try {
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey: key, status: 200, result })
    } catch (receiptError) {
      console.error('[mobile-transcription] success receipt completion failed:', receiptError)
      return NextResponse.json({
        ...result,
        warning: 'Transcript was created, but retry reconciliation is pending. Use this transcript and do not submit the recording again.',
      }, { headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileAttachmentError ? error.status : 503
    const message = error instanceof Error && error.name !== 'TimeoutError'
      ? error.message
      : 'Voice transcription timed out. Your audio draft is still available.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
