export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasGoogleOAuthConfig } from '@/lib/gmail-sync'
import { getCurrentUserEmail, isCurrentUserAdmin } from '@/lib/auth/admin'

// GET /api/auth/google/status — list connected Google accounts
export async function GET(req: NextRequest) {
  const requestedEmail = new URL(req.url).searchParams.get('user_email')?.trim().toLowerCase()
  const currentEmail = await getCurrentUserEmail()
  const userEmail = requestedEmail || currentEmail

  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (requestedEmail && requestedEmail !== currentEmail && !(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = supabaseAdmin()
  let query = db
    .from('user_oauth_tokens')
    .select('user_email, last_sync_at, created_at, scope')
    .eq('provider', 'google')
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false })

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    accounts: data || [],
    oauthConfigured: hasGoogleOAuthConfig(),
  })
}
