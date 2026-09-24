export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { crmEmailForConnectedGoogleAccount, decodeGoogleOAuthState } from '@/lib/google-oauth-state'
import { markOAuthConnected } from '@/lib/oauth-health'

type GoogleOAuthProvider = 'google' | 'google_ads'

function statusKeys(provider: GoogleOAuthProvider) {
  return provider === 'google_ads'
    ? { success: 'google_ads_oauth_success', error: 'google_ads_oauth_error' }
    : { success: 'oauth_success', error: 'oauth_error' }
}

function redirectWithStatus(origin: string, returnTo: string, key: string, value: string) {
  const redirectUrl = new URL(returnTo, origin)
  redirectUrl.searchParams.set(key, value)
  return NextResponse.redirect(redirectUrl)
}

// GET /api/auth/google/callback?code=...&state=...
// Exchanges the authorization code for tokens and stores them.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const { returnTo, provider, crmEmail: stateCrmEmail } = decodeGoogleOAuthState(state)
  const keys = statusKeys(provider)

  if (error) {
    return redirectWithStatus(url.origin, returnTo, keys.error, error)
  }

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
  }

  const clientId = provider === 'google_ads'
    ? process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID
    : process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = provider === 'google_ads'
    ? process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET
    : process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return redirectWithStatus(url.origin, returnTo, keys.error, 'google_oauth_not_configured')
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
    return redirectWithStatus(url.origin, returnTo, keys.error, 'token_exchange_failed')
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
    scope: string
  }

  if (provider === 'google_ads' && !tokens.scope.split(/\s+/).includes('https://www.googleapis.com/auth/adwords')) {
    return redirectWithStatus(url.origin, returnTo, keys.error, 'missing_adwords_scope')
  }

  // Fetch user email to key the tokens by
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const userInfo = await userRes.json() as { email: string }

  if (!userInfo.email) {
    return redirectWithStatus(url.origin, returnTo, keys.error, 'no_email')
  }

  if (!tokens.refresh_token) {
    // Google doesn't return refresh token if user already granted access
    // User should revoke access at https://myaccount.google.com/permissions and retry
    return redirectWithStatus(url.origin, returnTo, keys.error, 'no_refresh_token_revoke_and_retry')
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const googleEmail = userInfo.email.trim().toLowerCase()
  const sessionEmail = await getCurrentUserEmail()
  const crmEmail = crmEmailForConnectedGoogleAccount({ sessionEmail, stateCrmEmail })

  const db = supabaseAdmin()
  const tokenRow = {
    user_email: googleEmail,
    provider,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: expiresAt,
    scope: tokens.scope,
    updated_at: new Date().toISOString(),
    ...(crmEmail ? { crm_user_email: crmEmail } : {}),
  }
  if (crmEmail) {
    await db
      .from('user_oauth_tokens')
      .update({ crm_user_email: null, updated_at: tokenRow.updated_at })
      .eq('provider', provider)
      .eq('crm_user_email', crmEmail)
      .neq('user_email', googleEmail)
  }
  let { error: upsertError } = await db
    .from('user_oauth_tokens')
    .upsert(tokenRow, { onConflict: 'user_email,provider' })
  if (upsertError && crmEmail && /crm_user_email/i.test(upsertError.message || '')) {
    const withoutCrmLink = { ...tokenRow }
    delete withoutCrmLink.crm_user_email
    const retry = await db
      .from('user_oauth_tokens')
      .upsert(withoutCrmLink, { onConflict: 'user_email,provider' })
    upsertError = retry.error
  }

  if (upsertError) {
    console.error('[oauth/callback] Token upsert failed:', upsertError)
    return redirectWithStatus(url.origin, returnTo, keys.error, 'storage_failed')
  }

  await markOAuthConnected(db, provider, googleEmail)

  return redirectWithStatus(url.origin, returnTo, keys.success, googleEmail)
}
