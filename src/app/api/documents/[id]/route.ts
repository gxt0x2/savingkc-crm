export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { DOCUMENTS_BUCKET } from '@/lib/documents'

// DELETE /api/documents/[id] — removes the storage object and DB row.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const db = supabaseAdmin()

    const { data: row } = await db
      .from('documents')
      .select('id, storage_path')
      .eq('id', id)
      .single()
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

    await db.storage.from(DOCUMENTS_BUCKET).remove([row.storage_path]).catch(err => {
      console.error('[documents DELETE] storage remove failed (continuing):', err)
    })
    const { error } = await db.from('documents').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[documents DELETE] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// PATCH /api/documents/[id] — update doc_type or notes.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const updates: Record<string, unknown> = {}
    if (body.doc_type !== undefined) updates.doc_type = String(body.doc_type)
    if (body.notes !== undefined) updates.notes = body.notes === null ? null : String(body.notes)
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'no valid fields' }, { status: 400 })
    }
    const db = supabaseAdmin()
    const { data, error } = await db.from('documents').update(updates).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ document: data })
  } catch (err) {
    console.error('[documents PATCH] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
