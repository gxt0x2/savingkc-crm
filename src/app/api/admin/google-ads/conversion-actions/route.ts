import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import {
  ensureSearch2026OfflineConversionActions,
  inspectGoogleAdsConversionActions,
  SEARCH_2026_OFFLINE_ACTION_SPECS,
} from '@/lib/ppc/google-ads-conversion-actions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const result = await inspectGoogleAdsConversionActions()
    return NextResponse.json(result, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[google-ads/conversion-actions] inspection failed', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(req.url)
  const apply = searchParams.get('apply') === '1' || searchParams.get('apply') === 'true'

  if (!apply) {
    return NextResponse.json(
      {
        ok: false,
        apply: false,
        message: 'Add ?apply=true to create the standard Search 2026 offline conversion actions.',
        plannedActions: SEARCH_2026_OFFLINE_ACTION_SPECS,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const result = await ensureSearch2026OfflineConversionActions()
    return NextResponse.json(result, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[google-ads/conversion-actions] create failed', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
