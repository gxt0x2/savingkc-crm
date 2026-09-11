import { createHash } from 'node:crypto'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'
import { serializeMojoSource } from '@/lib/mojo-source-identity.mjs'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Private immutable source archive. No lifecycle effects or outgoing messages.
export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized
  try {
    const { id, payload, runtime } = await req.json()
    const serialized = serializeMojoSource(payload)
    if (!payload || !Array.isArray(payload.activities) || !Array.isArray(payload.recordings)
      || payload.version !== 'source-receipts-v1' || !Number.isFinite(Date.parse(payload.since))
      || !/^\d{4}-\d{2}-\d{2}$/.test(payload.to) || Buffer.byteLength(serialized, 'utf8') > 3_000_000 || !/^[a-f0-9]{64}$/.test(id)
      || createHash('sha256').update(serialized).digest('hex') !== id) {
      return NextResponse.json({ error: 'Invalid source batch or checksum' }, { status: 400 })
    }
    if (runtime?.contentDigest !== expectedRuntime.contentDigest) {
      return NextResponse.json({ error: 'Mojo importer update required', expectedDigest: expectedRuntime.contentDigest }, { status: 409 })
    }
    const { error } = await supabaseAdmin().from('mojo_source_batches').upsert({
      id, payload, runtime_version: String(payload.runtime?.revision || payload.version).slice(0, 160),
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: 'Source archive unavailable' }, { status: 503 })
    const { data: receipt, error: receiptError } = await supabaseAdmin().from('mojo_source_batches')
      .select('accepted_at').eq('id', id).single()
    if (receiptError) return NextResponse.json({ error: 'Source receipt unavailable' }, { status: 503 })
    const { error: runtimeError } = await supabaseAdmin().from('system_config').upsert([
      { key: 'mojo_runtime_content_digest', value: runtime.contentDigest, updated_at: new Date().toISOString() },
      { key: 'mojo_runtime_revision', value: String(runtime.revision || 'unknown'), updated_at: new Date().toISOString() },
    ], { onConflict: 'key' })
    if (runtimeError) return NextResponse.json({ error: 'Runtime receipt unavailable' }, { status: 503 })
    return NextResponse.json({ ok: true, id, accepted: Boolean(receipt?.accepted_at) })
  } catch {
    return NextResponse.json({ error: 'Invalid source batch' }, { status: 400 })
  }
}

// Recover retained batches after runtime replacement or local disk loss.
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized
  const after = new URL(req.url).searchParams.get('after')
  if (after && !/^[a-f0-9]{64}$/.test(after)) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
  let query = supabaseAdmin().from('mojo_source_batches')
    .select('id,payload').is('accepted_at', null).order('id').limit(1)
  if (after) query = query.gt('id', after)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Source archive unavailable' }, { status: 503 })
  return NextResponse.json({ batches: data, nextCursor: data?.[0]?.id || null })
}

export async function PATCH(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized
  try {
    const { id, recordIds, runtime, error: failure } = await req.json()
    if (/^[a-f0-9]{64}$/.test(id) && typeof failure === 'string' && failure.trim()) {
      const { error } = await supabaseAdmin().from('mojo_source_batches')
        .update({ last_error: failure.slice(0, 1000) }).eq('id', id).is('accepted_at', null)
      return NextResponse.json({ ok: !error }, { status: error ? 503 : 200 })
    }
    if (runtime?.contentDigest !== expectedRuntime.contentDigest) return NextResponse.json({ error: 'Mojo importer update required' }, { status: 409 })
    if (!/^[a-f0-9]{64}$/.test(id) || !Array.isArray(recordIds)
      || recordIds.length > 10_000 || recordIds.some(value => typeof value !== 'string')) {
      return NextResponse.json({ error: 'Invalid acceptance manifest' }, { status: 400 })
    }
    const uniqueIds = [...new Set<string>(recordIds)]
    const db = supabaseAdmin()
    for (let offset = 0; offset < uniqueIds.length; offset += 100) {
      const ids = uniqueIds.slice(offset, offset + 100)
      const { count, error } = await db.from('mojo_call_queue')
        .select('id', { head: true, count: 'exact' }).in('record_id', ids)
      if (error || count !== ids.length) {
        return NextResponse.json({ error: 'Acceptance manifest contains missing queue records' }, { status: 409 })
      }
      const { data: receipts, error: receiptError } = await db.from('mojo_source_call_receipts')
        .select('queue_record_id').eq('source_batch_id', id).in('queue_record_id', ids)
      if (receiptError || new Set((receipts || []).map(row => row.queue_record_id)).size !== ids.length) {
        return NextResponse.json({ error: 'Acceptance manifest lacks source delivery receipts' }, { status: 409 })
      }
    }
    const { data, error } = await db.from('mojo_source_batches')
      .update({ accepted_at: new Date().toISOString(), last_error: null, record_ids: uniqueIds,
        accepted_runtime_digest: runtime.contentDigest, accepted_runtime_revision: String(runtime.revision || 'unknown') })
      .eq('id', id).select('id').maybeSingle()
    if (error || !data) return NextResponse.json({ error: 'Source receipt unavailable' }, { status: 503 })
    return NextResponse.json({ ok: true, id })
  } catch {
    return NextResponse.json({ error: 'Invalid acceptance manifest' }, { status: 400 })
  }
}
