import { createHash, randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type MessageSendClaim =
  | { kind: 'reserved' | 'recovered'; token: string; receiptId: string; state: string; providerId: string | null; result: Record<string, unknown> | null; providerKey: string }
  | { kind: 'replay'; status: number; result: Record<string, unknown> }
  | { kind: 'pending' }
  | { kind: 'conflict' }

export function hashMobileMessageKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function mobileMessageProviderKey(userId: string, key: string): string {
  return `mobile-message-${createHash('sha256').update(`${userId}\0${key}`).digest('hex')}`
}

export function mobileMessagePayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function claimMobileMessageSend(input: {
  userId: string
  keyHash: string
  leadId: string
  channel: 'sms' | 'email'
  payloadHash: string
  providerKey: string
}): Promise<MessageSendClaim> {
  const token = randomUUID()
  const { data, error } = await supabaseAdmin().rpc('claim_mobile_message_send_v1', {
    p_actor_user_id: input.userId,
    p_key_hash: input.keyHash,
    p_lead_id: input.leadId,
    p_channel: input.channel,
    p_payload_hash: input.payloadHash,
    p_lease_token: token,
    p_provider_key: input.providerKey,
  })
  if (error) throw new Error(error.message)
  const result = data as Record<string, unknown> | null
  if (!result || typeof result.kind !== 'string') throw new Error('Mobile message receipt returned an invalid claim')
  if (result.kind === 'pending' || result.kind === 'conflict') return { kind: result.kind }
  if (result.kind === 'replay') return {
    kind: 'replay', status: Number(result.status) || 409,
    result: result.result && typeof result.result === 'object' ? result.result as Record<string, unknown> : {},
  }
  if (result.kind !== 'reserved' && result.kind !== 'recovered') throw new Error('Mobile message receipt returned an unknown claim')
  if (typeof result.token !== 'string' || typeof result.receipt_id !== 'string' || typeof result.provider_key !== 'string') {
    throw new Error('Mobile message receipt returned an incomplete claim')
  }
  return {
    kind: result.kind,
    token: result.token,
    receiptId: result.receipt_id,
    state: typeof result.state === 'string' ? result.state : 'reserved',
    providerId: typeof result.provider_id === 'string' ? result.provider_id : null,
    result: result.result && typeof result.result === 'object' ? result.result as Record<string, unknown> : null,
    providerKey: result.provider_key,
  }
}

export async function transitionMobileMessageSend(input: {
  userId: string
  keyHash: string
  token: string
  from: string
  to: string
  providerId?: string | null
  status: number
  result: Record<string, unknown>
}): Promise<void> {
  const { data, error } = await supabaseAdmin().rpc('transition_mobile_message_send_v1', {
    p_actor_user_id: input.userId,
    p_key_hash: input.keyHash,
    p_lease_token: input.token,
    p_from_state: input.from,
    p_to_state: input.to,
    p_provider_id: input.providerId ?? null,
    p_http_status: input.status,
    p_result: input.result,
  })
  if (error || data !== true) throw new Error(error?.message || 'Mobile message receipt lease was superseded')
}
