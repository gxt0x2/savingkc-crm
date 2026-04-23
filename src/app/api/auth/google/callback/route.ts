export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/auth/google/callback?code=...&state=...
// Exchanges the authorization code for tokens and stores them.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${url.origin}/settings?oauth_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'OAuth not configured' }, { status: 500 })
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const errText = await tokenRes.text()
    console.error('[oauth/callback] Token exchange failed:', errText)
    return NextResponse.redirect(`${url.origin}/settings?oauth_error=token_exchange_failed`)
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
    scope: string
  }

  // Fetch user email to key the tokens by
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const userInfo = await userRes.json() as { email: string }

  if (!userInfo.email) {
    return NextResponse.redirect(`${url.origin}/settings?oauth_error=no_email`)
  }

  if (!tokens.refresh_token) {
    // Google doesn't return refresh token if user already granted access
    // User should revoke access at https://myaccount.google.com/permissions and retry
    return NextResponse.redirect(`${url.origin}/settings?oauth_error=no_refresh_token_revoke_and_retry`)
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  const db = supabaseAdmin()
  const { error: upsertError } = await db
    .from('user_oauth_tokens')
    .upsert({
      user_email: userInfo.email,
      provider: 'google',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_at: expiresAt,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_email,provider' })

  if (upsertError) {
    console.error('[oauth/callback] Token upsert failed:', upsertError)
    return NextResponse.redirect(`${url.origin}/settings?oauth_error=storage_failed`)
  }

  let returnTo = '/settings'
  try {
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
      if (decoded.return_to) returnTo = decoded.return_to
    }
  } catch { /* ignore */ }

  return NextResponse.redirect(`${url.origin}${returnTo}?oauth_success=${encodeURIComponent(userInfo.email)}`)
}
