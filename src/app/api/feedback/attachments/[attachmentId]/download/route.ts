import { NextRequest, NextResponse } from 'next/server'

import { ANDON_ATTACHMENTS_BUCKET } from '@/lib/andon-attachments'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { attachmentId } = await params
    const preview = req.nextUrl.searchParams.get('preview') === '1'
    const db = supabaseAdmin()
    const { data: attachment, error } = await db
      .from('feedback_attachments')
      .select('storage_path, filename')
      .eq('id', attachmentId)
      .single()
    if (error || !attachment) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 })

    const { data: signed, error: signError } = await db.storage
      .from(ANDON_ATTACHMENTS_BUCKET)
      .createSignedUrl(attachment.storage_path, 60 * 60, {
        download: preview ? false : attachment.filename,
      })
    if (signError || !signed) return NextResponse.json({ error: 'Attachment access could not be signed.' }, { status: 500 })

    return NextResponse.redirect(signed.signedUrl, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('[Andon attachments] download failed:', error)
    return NextResponse.json({ error: 'Attachment could not be opened.' }, { status: 500 })
  }
}
