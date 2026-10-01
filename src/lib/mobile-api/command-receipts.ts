import { createHash, randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type ReceiptReservation =
  | { kind: 'reserved' | 'recovered'; token: string; plan: Record<string, unknown> | null }
  | { kind: 'replay'; status: number; result: Record<string, unknown> }
  | { kind: 'pending' }
  | { kind: 'conflict' }

export function mobileCommandPayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/** Stable UUID for one actor/key/command; never use a timestamp for retryable effects. */
export function mobileCommandIdentityUuid(actorEmail: string, key: string, command: string): string {
  const bytes = createHash('sha256').update(`${actorEmail.toLowerCase()}\0${key}\0${command}`).digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function reserveMobileCommand(input: {
  actorEmail: string
  idempotencyKey: string
  command: string
  leadId: string
  payloadHash: string
}): Promise<ReceiptReservation> {
  const token = randomUUID()
  const { data, error } = await supabaseAdmin().rpc('claim_mobile_command_v2', {
    p_actor_email: input.actorEmail, p_idempotency_key: input.idempotencyKey,
    p_command: input.command, p_lead_id: input.leadId,
    p_payload_hash: input.payloadHash, p_lease_token: token,
  })
  if (error) throw new Error(error.message)
  const claim = data as ReceiptReservation | null
  if (!claim || !['reserved', 'recovered', 'replay', 'pending', 'conflict'].includes(claim.kind)) throw new Error('Mobile command claim returned invalid state')
  return claim
}

export async function completeMobileCommand(input: {
  actorEmail: string
  idempotencyKey: string
  token: string
  status: number
  result: Record<string, unknown>
}): Promise<void> {
  const { data, error } = await supabaseAdmin().rpc('finish_mobile_command_v2', {
    p_actor_email: input.actorEmail, p_idempotency_key: input.idempotencyKey,
    p_lease_token: input.token, p_http_status: input.status, p_result: input.result,
  })
  if (error || data !== true) throw new Error(error?.message || 'Mobile command lease was superseded')
}

export async function planMobileCommandEffect(input: {
  actorEmail: string; idempotencyKey: string; token: string; plan: Record<string, unknown>
}): Promise<void> {
  const { data, error } = await supabaseAdmin().rpc('plan_mobile_command_effect_v1', {
    p_actor_email: input.actorEmail, p_idempotency_key: input.idempotencyKey,
    p_lease_token: input.token, p_plan: input.plan,
  })
  if (error || data !== true) throw new Error(error?.message || 'Mobile command plan could not be fenced')
}
