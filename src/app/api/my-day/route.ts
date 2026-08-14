export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUserEmail } from '@/lib/auth/admin'
import { canAccessCaseyMyDay, loadCaseyMyDay } from '@/lib/my-day-server'

const NO_STORE_HEADERS: HeadersInit = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  if (!await canAccessCaseyMyDay(email)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })

  try {
    const data = await loadCaseyMyDay(request.nextUrl.searchParams.get('month'))
    return NextResponse.json(data, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[my-day] load failed:', error)
    return NextResponse.json({ error: 'My Day could not load.' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
