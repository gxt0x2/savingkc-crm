export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import {
  InvalidEntityConflictCursorError,
  readCrmEntityConflictsPage,
} from '@/lib/server/crm-entity-conflicts'

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const searchParams = new URL(request.url).searchParams
    const page = await readCrmEntityConflictsPage({
      limit: searchParams.get('limit'),
      cursor: searchParams.get('cursor'),
    })
    return NextResponse.json(page, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    if (error instanceof InvalidEntityConflictCursorError) {
      return NextResponse.json(
        { error: 'Invalid cursor.' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    console.error('CRM entity conflict page failed', error)
    return NextResponse.json(
      { error: 'CRM entity conflicts are unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}
