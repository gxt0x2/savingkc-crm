// Attribution for leads that arrive by phone call or text (schema v1).
//
// A call to the business line can be a website visitor, a Google Ads caller, or
// a seller returning a cold call. Mojo callback numbers forward to the business
// line, so the dialed number alone cannot tell those apart. This uses, in order:
//   1. the dialed number, when it is a Google Ads or cold-call callback line
//   2. the number the call was forwarded from, when it is a known Mojo line
//   3. whether the caller's number is on a prospect list we hold
// When none apply the origin is left unknown. Nothing is guessed.

import { getGoogleAdsPhoneProfile } from '@/lib/call-quality-events'
import { findTwilioNumber, normalizeTwilioNumber } from '@/lib/twilio-numbers'
import { nonWebAttribution, type LeadAttribution } from './lead-attribution'

export type InboundChannel = 'call' | 'sms'
export type InboundEvidence = 'tracking_number' | 'forwarded_from' | 'prospect_phone_match'

export type InboundAttributionInput = {
  channel: InboundChannel
  calledNumber?: string | null
  callSid?: string | null
  forwardedFrom?: string | null
  prospectMatched?: boolean
  /** Mojo caller-ID lines that forward callbacks to the business line. */
  mojoCallbackNumbers?: readonly string[]
  now?: string
}

/** Comma, semicolon or line separated list from MOJO_CALLBACK_NUMBERS, normalized to E.164. */
export function parseMojoCallbackNumbers(raw: string | null | undefined): string[] {
  return (raw || '')
    .split(/[,;\n]+/)
    .map((value) => normalizeTwilioNumber(value))
    .filter((value): value is string => Boolean(value))
}

export function buildInboundAttribution(input: InboundAttributionInput): LeadAttribution {
  const called = normalizeTwilioNumber(input.calledNumber)
  const forwardedFrom = normalizeTwilioNumber(input.forwardedFrom)
  const purpose = findTwilioNumber(called)?.purpose
  const mojoNumbers = new Set(input.mojoCallbackNumbers ?? [])

  const base = nonWebAttribution(
    input.channel === 'sms' ? 'inbound_sms' : 'inbound_call',
    {
      phone: {
        tracking_number: called ?? undefined,
        call_sid: input.callSid || undefined,
        // Only kept when the call really came through another line.
        forwarded_from: forwardedFrom && forwardedFrom !== called ? forwardedFrom : undefined,
      },
    },
    input.now,
  )

  const withOrigin = (
    evidence: InboundEvidence,
    firstTouch: NonNullable<LeadAttribution['first_touch']>,
    dialer?: LeadAttribution['dialer'],
  ): LeadAttribution => ({
    ...base,
    first_touch: firstTouch,
    ...(dialer ? { dialer } : {}),
    derived_from: `inbound:${evidence}`,
  })

  if (purpose === 'google_ads') {
    return withOrigin('tracking_number', {
      source: 'google',
      medium: 'cpc',
      campaign: getGoogleAdsPhoneProfile(called).campaign,
    })
  }
  if (purpose === 'cold_call') {
    return withOrigin('tracking_number', { source: 'cold_call', medium: 'callback' })
  }
  if (forwardedFrom && mojoNumbers.has(forwardedFrom)) {
    return withOrigin('forwarded_from', { source: 'cold_call', medium: 'callback' }, { provider: 'mojo' })
  }
  if (input.prospectMatched) {
    return withOrigin('prospect_phone_match', { source: 'cold_call', medium: 'callback' })
  }
  return { ...base, derived_from: 'inbound:unknown_origin' }
}
