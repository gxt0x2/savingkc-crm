import { NextRequest, NextResponse } from 'next/server'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { readOAuthHealth } from '@/lib/oauth-health'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  const db = supabaseAdmin()
  const configuredEmail = process.env.GOOGLE_ADS_REFRESH_TOKEN_USER_EMAIL?.trim().toLowerCase() || null
  let query = db
    .from('user_oauth_tokens')
    .select('user_email, last_sync_at, created_at, scope')
    .eq('provider', 'google_ads')
    .order('created_at', { ascending: false })
    .limit(1)

  if (configuredEmail) query = query.eq('user_email', configuredEmail)
  const { data, error } = await query.maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const userEmail = data?.user_email || configuredEmail
  const health = userEmail ? await readOAuthHealth(db, 'google_ads', userEmail) : null
  const oauthConfigured = Boolean(
    (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID)?.trim()
    && (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET)?.trim(),
  )

  return NextResponse.json({
    oauthConfigured,
    connected: Boolean(data),
    account: data || null,
    connectionStatus: health?.status || (data ? 'connected' : 'disconnected'),
    connectionErrorCode: health?.errorCode || null,
    connectionErrorMessage: health?.errorMessage || null,
    connectionCheckedAt: health?.checkedAt || null,
  })
}
