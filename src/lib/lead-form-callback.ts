import { getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { getTwilioClient } from '@/lib/safe-communications'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

type FormLeadCallbackInput = {
  leadId: string
  leadPhone: string
  callerId: string
  fullName: string
  address?: string | null
  city?: string | null
  trigger?: string
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

export function firstNameFromFullName(fullName: string | null | undefined): string {
  const cleaned = cleanText(fullName)
  return cleaned.split(/\s+/)[0] || 'A seller'
}

export function streetFromAddress(address: string | null | undefined): string {
  const cleaned = cleanText(address)
  if (!cleaned) return 'their property'
  return cleaned.split(',')[0]?.trim() || cleaned
}

export function buildFormLeadCallbackIntro(input: {
  fullName?: string | null
  address?: string | null
  city?: string | null
}): string {
  const firstName = firstNameFromFullName(input.fullName)
  const street = streetFromAddress(input.address)
  const city = cleanText(input.city)

  return city
    ? `${firstName} is looking to sell their place on ${street} in ${city}. Calling them now.`
    : `${firstName} is looking to sell their place on ${street}. Calling them now.`
}

export async function startPpcFormLeadAgentCallback(input: FormLeadCallbackInput): Promise<{
  started: boolean
  sid?: string
  to?: string
  error?: string
}> {
  const client = getTwilioClient()
  if (!client) {
    return { started: false, error: 'Twilio client not initialized' }
  }

  const recipient = getLeadAlertRecipients()[0]
  if (!recipient?.phone) {
    return { started: false, error: 'No lead alert recipient available' }
  }

  const callbackUrl = new URL('/api/ivr/form-lead-agent-callback', BASE_URL)
  callbackUrl.searchParams.set('leadId', input.leadId)
  callbackUrl.searchParams.set('leadPhone', input.leadPhone)
  callbackUrl.searchParams.set('callerId', input.callerId)
  callbackUrl.searchParams.set('fullName', input.fullName)
  if (input.address) callbackUrl.searchParams.set('address', input.address)
  if (input.city) callbackUrl.searchParams.set('city', input.city)
  if (input.trigger) callbackUrl.searchParams.set('trigger', input.trigger)

  try {
    const call = await client.calls.create({
      to: recipient.phone,
      from: input.callerId,
      url: callbackUrl.toString(),
      method: 'POST',
      timeout: 20,
    })

    return { started: true, sid: call.sid, to: recipient.phone }
  } catch (error) {
    console.error('[lead-form-callback] Agent callback failed:', error)
    return { started: false, error: error instanceof Error ? error.message : 'Unknown Twilio error' }
  }
}
