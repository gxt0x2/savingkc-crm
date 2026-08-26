export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUserEmail } from '@/lib/auth/admin'
import { canAccessCaseyMyDay, loadCaseyMyDay } from '@/lib/my-day-server'
import { recordMyDayMojoReview } from '@/lib/server/my-day-attention-review'

const NO_STORE_HEADERS: HeadersInit = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  if (!await canAccessCaseyMyDay(email)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })

  try {
    const search = request.nextUrl.searchParams
    const data = await loadCaseyMyDay({
      preset: search.get('range'),
      from: search.get('from'),
      to: search.get('to'),
      month: search.get('month'),
    })
    return NextResponse.json(data, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[my-day] load failed:', error)
    return NextResponse.json({ error: 'My Day could not load.' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function POST(request: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  if (!await canAccessCaseyMyDay(email)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })

  let recordId = ''
  try {
    const body = await request.json() as { recordId?: unknown }
    recordId = typeof body.recordId === 'string' ? body.recordId.trim() : ''
  } catch {
    return NextResponse.json({ error: 'A valid Mojo record is required.' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  if (!recordId || recordId.length > 160) {
    return NextResponse.json({ error: 'A valid Mojo record is required.' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const result = await recordMyDayMojoReview({ recordId, reviewedBy: email })
    if (!result) return NextResponse.json({ error: 'Review item not found.' }, { status: 404, headers: NO_STORE_HEADERS })
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[my-day] review failed:', error)
    return NextResponse.json({ error: 'The review could not be saved.' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
