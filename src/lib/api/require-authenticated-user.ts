import { NextResponse } from 'next/server'
import { hasVerifiedSubject } from '@/lib/auth/verified-claims'
import { createClient } from '@/lib/supabase/server'

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
}

export async function requireAuthenticatedUser(
  body: Record<string, unknown> = { error: 'Unauthorized' },
): Promise<NextResponse | null> {
  try {
    const authClient = await createClient()
    if (hasVerifiedSubject(await authClient.auth.getClaims())) return null
  } catch {
    // Fail closed when the session cannot be verified locally.
  }
  return NextResponse.json(body, { status: 401, headers: PRIVATE_NO_STORE_HEADERS })
}
