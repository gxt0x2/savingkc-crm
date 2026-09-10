import { createHash } from 'node:crypto'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'
import { serializeMojoSource } from '@/lib/mojo-source-identity.mjs'
import { mojoLegacyRecordIds, validateMojoSourceCall } from '@/lib/mojo-source-proof.mjs'
import type { MojoCallRecord } from './mojo-call-import'
import type { supabaseAdmin } from '@/lib/supabase/admin'

type Db = ReturnType<typeof supabaseAdmin>
export async function loadMojoIntakeSource(db: Db, body: { sourceBatchId?: unknown; runtime?: { contentDigest?: unknown } }) {
  if (body.runtime?.contentDigest !== expectedRuntime.contentDigest) return { error: 'importer_update_required', status: 409 } as const
  if (typeof body.sourceBatchId !== 'string' || !/^[a-f0-9]{64}$/.test(body.sourceBatchId)) return { error: 'source_batch_required', status: 400 } as const
  const { data, error } = await db.from('mojo_source_batches').select('id,payload').eq('id', body.sourceBatchId).maybeSingle()
  if (error) return { error: 'source_archive_unavailable', status: 503 } as const
  if (!data || createHash('sha256').update(serializeMojoSource(data.payload)).digest('hex') !== data.id) return { error: 'source_batch_not_archived', status: 409 } as const
  return { id: data.id as string, payload: data.payload, digest: expectedRuntime.contentDigest }
}

export async function admitMojoCall(db: Db, raw: MojoCallRecord, source: { id: string; payload: unknown }) {
  const failure = validateMojoSourceCall(raw, source.payload)
  if (failure) throw new Error(failure)
  // Reuse pre-upgrade queue identities so callback tasks and lifecycle commands
  // retain their original idempotency keys. Ambiguous historical aliases stop.
  const ids = mojoLegacyRecordIds(raw)
  const rows: Array<{ record_id: string; payload: MojoCallRecord }> = []
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await db.from('mojo_call_queue').select('record_id,payload').in('record_id', ids.slice(offset, offset + 100))
    if (error) throw new Error('identity_lookup_failed')
    rows.push(...(data || []))
  }
  if (rows.length > 1) throw new Error('ambiguous_legacy_identity')
  const existing = rows[0]
  if (existing?.payload.provider_action_id && existing.payload.provider_action_id !== raw.provider_action_id) throw new Error('action_identity_conflict')
  return { ...raw, record_id: existing?.record_id || raw.record_id, source_batch_id: source.id }
}

export async function recordMojoIntakeReceipt(db: Db, source: { id: string; digest: string }, requestedId: string, queueId: string) {
  const { error } = await db.from('mojo_source_call_receipts').upsert({
    source_batch_id: source.id, requested_record_id: requestedId, queue_record_id: queueId, runtime_digest: source.digest,
  }, { onConflict: 'source_batch_id,requested_record_id' })
  if (error) throw new Error('source_receipt_write_failed')
}
