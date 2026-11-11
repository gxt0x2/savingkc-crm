/**
 * Writes the standard attribution record on a lead that arrived by call or text.
 *
 * Write-once: a lead that already has a schema v1 record (website form, import,
 * an earlier call) is left alone. Runs after the Twilio response is sent, so the
 * caller never waits on it, and it never throws.
 */
import twilio from 'twilio'
import { afterRequest } from '@/lib/after-request'
import {
  buildInboundAttribution,
  parseMojoCallbackNumbers,
  type InboundChannel,
} from '@/lib/attribution/inbound-attribution'
import type { LeadAttribution } from '@/lib/attribution/lead-attribution'
import { MOJO_CALLER_ID_NUMBERS } from '@/lib/twilio-numbers'

const CALL_SID = /^CA[0-9a-f]{32}$/i

export type InboundLeadAttributionInput = {
  leadId: string | null | undefined
  channel: InboundChannel
  callerNumber?: string | null
  calledNumber?: string | null
  callSid?: string | null
  /** Pass when the route already looked the caller up; otherwise it is looked up here. */
  prospectMatched?: boolean
}

export type InboundLeadAttributionDeps = {
  loadAttribution: (leadId: string) => Promise<unknown>
  saveAttribution: (leadId: string, attribution: LeadAttribution) => Promise<void>
  isProspectPhone: (phone: string) => Promise<boolean>
  fetchForwardedFrom: (callSid: string) => Promise<string | null>
  mojoCallbackNumbers: () => string[]
}

function cleanEnv(name: string): string {
  return (process.env[name] || '').trim()
}

async function fetchForwardedFromTwilio(callSid: string): Promise<string | null> {
  const accountSid = cleanEnv('TWILIO_ACCOUNT_SID')
  const apiKey = cleanEnv('TWILIO_API_KEY')
  const apiSecret = cleanEnv('TWILIO_API_SECRET')
  const authToken = cleanEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid) return null
  const client = apiKey && apiSecret
    ? twilio(apiKey, apiSecret, { accountSid, timeout: 8_000 })
    : authToken ? twilio(accountSid, authToken, { timeout: 8_000 }) : null
  if (!client) return null
  const call = await client.calls(callSid).fetch()
  return call.forwardedFrom || null
}

const defaultDeps: InboundLeadAttributionDeps = {
  async loadAttribution(leadId) {
    const { supabase } = await import('@/lib/supabase-lazy')
    const { data, error } = await supabase.from('leads').select('attribution').eq('id', leadId).maybeSingle()
    if (error) throw new Error(error.message)
    return data?.attribution ?? null
  },
  async saveAttribution(leadId, attribution) {
    const { supabase } = await import('@/lib/supabase-lazy')
    const { error } = await supabase.from('leads').update({ attribution }).eq('id', leadId)
    if (error) throw new Error(error.message)
  },
  async isProspectPhone(phone) {
    const { lookupProspectByPhone } = await import('@/lib/prospect-lookup')
    return (await lookupProspectByPhone(phone)).length > 0
  },
  fetchForwardedFrom: fetchForwardedFromTwilio,
  // MOJO_CALLBACK_NUMBERS adds caller IDs Mojo rotates in before the list here is updated.
  mojoCallbackNumbers: () => [...new Set([...MOJO_CALLER_ID_NUMBERS, ...parseMojoCallbackNumbers(process.env.MOJO_CALLBACK_NUMBERS)])],
}

function hasStandardRecord(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { schema?: unknown }).schema === 'lead_attribution_v1')
}

async function quietly<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    console.error(`[inbound attribution] ${label} failed:`, error instanceof Error ? error.message : error)
    return fallback
  }
}

/** Returns true when a record was written. */
export async function stampInboundLeadAttribution(
  input: InboundLeadAttributionInput,
  deps: InboundLeadAttributionDeps = defaultDeps,
): Promise<boolean> {
  const leadId = input.leadId
  if (!leadId) return false
  try {
    if (hasStandardRecord(await deps.loadAttribution(leadId))) return false

    const callSid = input.callSid && CALL_SID.test(input.callSid) ? input.callSid : null
    const [prospectMatched, forwardedFrom] = await Promise.all([
      input.prospectMatched !== undefined
        ? input.prospectMatched
        : input.callerNumber
          ? quietly('prospect lookup', () => deps.isProspectPhone(input.callerNumber as string), false)
          : false,
      input.channel === 'call' && callSid
        ? quietly('forwarded-from lookup', () => deps.fetchForwardedFrom(callSid), null)
        : null,
    ])

    await deps.saveAttribution(leadId, buildInboundAttribution({
      channel: input.channel,
      calledNumber: input.calledNumber,
      callSid,
      forwardedFrom,
      prospectMatched,
      mojoCallbackNumbers: deps.mojoCallbackNumbers(),
    }))
    return true
  } catch (error) {
    console.error('[inbound attribution] stamp failed:', error instanceof Error ? error.message : error)
    return false
  }
}

/** Schedule the stamp for after the webhook response. Safe to call for any lead. */
export function queueInboundLeadAttribution(input: InboundLeadAttributionInput): void {
  if (!input.leadId) return
  afterRequest(() => stampInboundLeadAttribution(input))
}
