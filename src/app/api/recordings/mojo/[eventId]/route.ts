import { NextRequest, NextResponse } from 'next/server'

import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { MOJO_RECORDINGS_BUCKET } from '@/lib/server/mojo-recording-archive'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const unauthorized = await requireAuthenticatedUser({ error: 'Unauthorized' })
  if (unauthorized) return unauthorized

  const { eventId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS })
  }

  const db = supabaseAdmin()
  const { data: event, error } = await db
    .from('crm_mojo_call_events')
    .select('recording_storage_path')
    .eq('id', eventId)
    .single()

  if (error || !event?.recording_storage_path) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS })
  }

  const { data: signed, error: signError } = await db.storage
    .from(MOJO_RECORDINGS_BUCKET)
    .createSignedUrl(event.recording_storage_path, 10 * 60)

  if (signError || !signed?.signedUrl) {
    console.error('[Mojo recording] signing failed:', signError)
    return NextResponse.json({ error: 'Recording unavailable' }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS })
  }

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
}
