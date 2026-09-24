export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasGoogleOAuthConfig } from '@/lib/gmail-sync'
import { getCurrentUserEmail, isCurrentUserAdmin } from '@/lib/auth/admin'
import { evaluateGoogleAccounts } from '@/lib/gmail-oauth-health'

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
  const oauthConfigured = hasGoogleOAuthConfig()
  const columns = 'id, user_email, last_sync_at, created_at, scope, refresh_token, access_token, expires_at'
  const direct = await db
    .from('user_oauth_tokens')
    .select(columns)
    .eq('provider', 'google')
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false })

  if (direct.error) return NextResponse.json({ error: direct.error.message }, { status: 500 })

  let data = direct.data || []
  if (data.length === 0) {
    const linked = await db
      .from('user_oauth_tokens')
      .select(columns)
      .eq('provider', 'google')
      .eq('crm_user_email', userEmail)
      .order('created_at', { ascending: false })
    const missingLinkColumn = /crm_user_email/i.test(linked.error?.message || '')
    if (linked.error && !missingLinkColumn) {
      return NextResponse.json({ error: linked.error.message }, { status: 500 })
    }
    if (!linked.error) data = linked.data || []
  }

  const accounts = await evaluateGoogleAccounts({
    db,
    oauthConfigured,
    accounts: data,
  })

  return NextResponse.json({
    accounts,
    oauthConfigured,
  })
}
