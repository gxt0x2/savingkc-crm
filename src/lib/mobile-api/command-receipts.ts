import { createHash } from 'node:crypto'

import { supabaseAdmin } from '@/lib/supabase/admin'

type ReceiptRow = {
  actor_email: string
  idempotency_key: string
  command: string
  lead_id: string
  payload_hash: string
  state: 'pending' | 'completed'
  http_status: number | null
  result: Record<string, unknown> | null
}

export type ReceiptReservation =
  | { kind: 'reserved' }
  | { kind: 'replay'; status: number; result: Record<string, unknown> }
  | { kind: 'pending' }
  | { kind: 'conflict' }

export function mobileCommandPayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function reserveMobileCommand(input: {
  actorEmail: string
  idempotencyKey: string
  command: string
  leadId: string
  payloadHash: string
}): Promise<ReceiptReservation> {
  const db = supabaseAdmin()
  const row = {
    actor_email: input.actorEmail,
    idempotency_key: input.idempotencyKey,
    command: input.command,
    lead_id: input.leadId,
    payload_hash: input.payloadHash,
    state: 'pending',
  }
  const created = await db.from('mobile_command_receipts').insert(row)
  if (!created.error) return { kind: 'reserved' }
  if (created.error.code !== '23505') throw new Error(created.error.message)

  const { data, error } = await db.from('mobile_command_receipts')
    .select('actor_email,idempotency_key,command,lead_id,payload_hash,state,http_status,result')
    .eq('actor_email', input.actorEmail)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const existing = data as ReceiptRow | null
  if (!existing) throw new Error('Mobile command receipt disappeared after conflict')
  if (existing.command !== input.command || existing.lead_id !== input.leadId || existing.payload_hash !== input.payloadHash) {
    return { kind: 'conflict' }
  }
  if (existing.state === 'completed' && existing.http_status && existing.result) {
    return { kind: 'replay', status: existing.http_status, result: existing.result }
  }
  return { kind: 'pending' }
}

export async function completeMobileCommand(input: {
  actorEmail: string
  idempotencyKey: string
  status: number
  result: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabaseAdmin().from('mobile_command_receipts').update({
    state: 'completed',
    http_status: input.status,
    result: input.result,
    updated_at: new Date().toISOString(),
  }).eq('actor_email', input.actorEmail).eq('idempotency_key', input.idempotencyKey)
  if (error) throw new Error(error.message)
}
