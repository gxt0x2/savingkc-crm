import { NextRequest, NextResponse } from 'next/server'

import { DOCUMENTS_BUCKET } from '@/lib/documents'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    await requireMobileUser(req)
    const { id, attachmentId } = await params
    const db = supabaseAdmin()
    const { data: row, error } = await db.from('documents')
      .select('id,storage_path,mime_type')
      .eq('id', attachmentId)
      .eq('entity_type', 'lead')
      .eq('entity_id', id)
      .eq('doc_type', 'message_attachment')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!row) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404, headers: mobileNoStoreHeaders() })
    const { data: signed, error: signedError } = await db.storage.from(DOCUMENTS_BUCKET).createSignedUrl(row.storage_path, 15 * 60)
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || 'Signed URL was not created')
    return NextResponse.json({ url: signed.signedUrl, mimeType: row.mime_type, expiresIn: 900 }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 503
    const message = error instanceof MobileAuthError ? error.message : 'Attachment could not be opened.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
