import { NextResponse } from 'next/server'

import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { INBOUND_MMS_BUCKET, isSafeInboundMmsPath } from '@/lib/inbound-mms-view'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauthorized = await requireAuthenticatedUser()
  if (unauthorized) {
    unauthorized.headers.set('Cache-Control', 'private, no-store')
    return unauthorized
  }
  const path = new URL(request.url).searchParams.get('path')?.trim() || ''
  if (!isSafeInboundMmsPath(path)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  }
  const { data, error } = await supabaseAdmin().storage.from(INBOUND_MMS_BUCKET).download(path)
  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  }
  const bytes = new Uint8Array(await data.arrayBuffer())
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': data.type || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
