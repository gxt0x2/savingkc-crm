import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUserEmail } from '@/lib/auth/admin'
import { WebsiteConversionReadError, loadWebsiteConversionReport } from '@/lib/marketing/website-conversion-load'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET(req: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })

  try {
    const report = await loadWebsiteConversionReport(supabaseAdmin(), new URL(req.url).searchParams.get('range'))
    return NextResponse.json(report, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof WebsiteConversionReadError ? error.message : 'Website conversion data could not be read.'
    console.error('[website-conversion] failed', error)
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
