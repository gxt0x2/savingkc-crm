import { NextResponse } from 'next/server'
import { validateTwilioWebhook } from '@/lib/twilio-validate'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CALL_SID = /^CA[0-9a-f]{32}$/i
const CALL_STATUS = /^(initiated|ringing|answered|completed|busy|failed|no-answer|canceled|cancelled)$/i
const ERROR_CODE = /^\d{1,6}$/

function bounded(value: FormDataEntryValue | null, pattern: RegExp): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return pattern.test(trimmed) ? trimmed : null
}

function clientIdentity(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith('client:')) return null
  const identity = trimmed.slice('client:'.length)
  return /^[a-z0-9_-]{1,80}$/i.test(identity) ? identity : null
}

/**
 * Twilio statusCallback for the inbound company-line <Client> leg.
 * Records whether the app identity was initiated, rang, answered, or completed.
 * The cellular <Number> leg is not wired here and is left unchanged.
 */
export async function POST(req: Request) {
  let verified = false
  try {
    verified = await validateTwilioWebhook(req)
  } catch (error) {
    console.error('[inbound-client-leg] signature validation failed', error instanceof Error ? error.message : 'unknown')
  }
  if (!verified) {
    return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 })
  }

  const body = await req.formData()
  console.info('[inbound-client-leg]', {
    callSid: bounded(body.get('CallSid'), CALL_SID),
    parentCallSid: bounded(body.get('ParentCallSid'), CALL_SID),
    status: bounded(body.get('CallStatus'), CALL_STATUS),
    errorCode: bounded(body.get('ErrorCode'), ERROR_CODE),
    client: clientIdentity(body.get('To')),
  })

  return new NextResponse(null, { status: 204 })
}
