export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { DOCUMENTS_BUCKET, buildStoragePath, type EntityType } from '@/lib/documents'

const ALLOWED_ENTITIES: EntityType[] = ['lead', 'offer', 'buyer', 'deal', 'dispo_deal']

// GET /api/documents?entity_type=lead&entity_id=<uuid>[&doc_type=...]
// Lists documents attached to the given entity, newest first.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const entity_type = searchParams.get('entity_type')
    const entity_id = searchParams.get('entity_id')
    const doc_type = searchParams.get('doc_type')

    if (!entity_type || !entity_id) {
      return NextResponse.json({ error: 'entity_type and entity_id required' }, { status: 400 })
    }
    if (!ALLOWED_ENTITIES.includes(entity_type as EntityType)) {
      return NextResponse.json({ error: 'invalid entity_type' }, { status: 400 })
    }

    let q = supabaseAdmin()
      .from('documents')
      .select('*')
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .order('uploaded_at', { ascending: false })

    if (doc_type) q = q.eq('doc_type', doc_type)

    const { data, error } = await q
    if (error) {
      console.error('[documents GET] supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ documents: data ?? [] })
  } catch (err) {
    console.error('[documents GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/documents
// multipart/form-data:
//   file            File
//   entity_type     'lead' | 'offer' | 'buyer' | 'deal' | 'dispo_deal'
//   entity_id       uuid
//   doc_type        e.g. 'purchase_contract'
//   notes           optional text
//   uploaded_by     optional display name/email
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    const entity_type = String(form.get('entity_type') || '')
    const entity_id = String(form.get('entity_id') || '')
    const doc_type = String(form.get('doc_type') || '')
    const notes = form.get('notes') ? String(form.get('notes')) : null
    const uploaded_by = form.get('uploaded_by') ? String(form.get('uploaded_by')) : null

    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
    if (!entity_type || !entity_id || !doc_type) {
      return NextResponse.json({ error: 'entity_type, entity_id, doc_type required' }, { status: 400 })
    }
    if (!ALLOWED_ENTITIES.includes(entity_type as EntityType)) {
      return NextResponse.json({ error: 'invalid entity_type' }, { status: 400 })
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'file exceeds 50 MB limit' }, { status: 413 })
    }

    const db = supabaseAdmin()
    const path = buildStoragePath(entity_type as EntityType, entity_id, file.name)
    const bytes = new Uint8Array(await file.arrayBuffer())

    const { error: upErr } = await db.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
    if (upErr) {
      console.error('[documents POST] storage upload error:', upErr)
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    const { data: row, error: insErr } = await db
      .from('documents')
      .insert({
        entity_type,
        entity_id,
        doc_type,
        filename: file.name,
        storage_path: path,
        mime_type: file.type || null,
        byte_size: file.size,
        notes,
        uploaded_by,
      })
      .select()
      .single()
    if (insErr) {
      // Roll back the storage upload so we don't orphan a file
      await db.storage.from(DOCUMENTS_BUCKET).remove([path]).catch(() => {})
      console.error('[documents POST] insert error:', insErr)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ document: row }, { status: 201 })
  } catch (err) {
    console.error('[documents POST] error:', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
