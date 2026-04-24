export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { DOCUMENTS_BUCKET } from '@/lib/documents'

// GET /api/documents/[id]/download[?preview=1]
// Returns a 1-hour signed URL for the file. The bucket stays private; we
// gate access through this route (already auth-fronted by our Next.js app).
// Use `preview=1` for inline viewing (PDFs/images embedded in a modal);
// default is attachment download.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const preview = searchParams.get('preview') === '1'

    const db = supabaseAdmin()
    const { data: row, error } = await db
      .from('documents')
      .select('id, storage_path, filename')
      .eq('id', id)
      .single()
    if (error || !row) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const { data: signed, error: sErr } = await db.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(row.storage_path, 60 * 60, {
        download: preview ? false : row.filename,
      })
    if (sErr || !signed) {
      console.error('[documents download] signing failed:', sErr)
      return NextResponse.json({ error: sErr?.message || 'sign failed' }, { status: 500 })
    }
    return NextResponse.redirect(signed.signedUrl, { status: 302 })
  } catch (err) {
    console.error('[documents download] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
