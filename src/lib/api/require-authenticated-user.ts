import { NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
}

export async function requireAuthenticatedUser(
  body: Record<string, unknown> = { error: 'Unauthorized' },
): Promise<NextResponse | null> {
  if (await getCurrentUserEmail()) return null
  return NextResponse.json(body, { status: 401, headers: PRIVATE_NO_STORE_HEADERS })
}
