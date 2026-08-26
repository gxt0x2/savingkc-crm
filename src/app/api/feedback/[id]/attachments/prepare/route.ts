import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import {
  ANDON_ATTACHMENTS_BUCKET,
  safeAndonAttachmentName,
  validateAndonAttachment,
} from '@/lib/andon-attachments'
import { requireAndonAttachmentOwner } from '@/lib/server/andon-attachment-access'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const parsed: unknown = await req.json()
    const body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
    const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim().toLowerCase() : ''
    const byteSize = typeof body.byte_size === 'number' ? body.byte_size : Number.NaN
    const validationError = validateAndonAttachment({ name: filename, type: mimeType, size: byteSize })
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

    const access = await requireAndonAttachmentOwner(id)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const storagePath = `feedback/${id}/${randomUUID()}-${safeAndonAttachmentName(filename)}`
    const { data, error } = await supabaseAdmin()
      .storage
      .from(ANDON_ATTACHMENTS_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false })

    if (error || !data) {
      console.error('[Andon attachments] signed upload creation failed:', error)
      return NextResponse.json(
        { error: 'Andon attachment storage is not ready. Apply the Andon attachments migration.' },
        { status: 503 },
      )
    }

    return NextResponse.json({
      bucket: ANDON_ATTACHMENTS_BUCKET,
      path: data.path,
      token: data.token,
    })
  } catch (error) {
    console.error('[Andon attachments] prepare failed:', error)
    return NextResponse.json({ error: 'The attachment upload could not be prepared.' }, { status: 500 })
  }
}
