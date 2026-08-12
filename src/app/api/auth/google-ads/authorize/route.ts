export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

function redirectWithError(origin: string, returnTo: string, value: string) {
  const errorUrl = new URL(returnTo, origin)
  errorUrl.searchParams.set('google_ads_oauth_error', value)
  return NextResponse.redirect(errorUrl)
}

// GET /api/auth/google-ads/authorize?return_to=/marketing/google-ads
// Starts a dedicated Google Ads OAuth flow so the exporter can upload approved
// offline conversions without reusing the Gmail/Calendar token.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const rawReturnTo = url.searchParams.get('return_to')
  const returnTo = rawReturnTo?.startsWith('/') ? rawReturnTo : '/marketing/google-ads'
  const origin = url.origin

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return redirectWithError(origin, returnTo, 'google_ads_oauth_not_configured')
  }

  const redirectUri = `${origin}/api/auth/google/callback`
  const state = Buffer.from(JSON.stringify({ return_to: returnTo, provider: 'google_ads' })).toString('base64url')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
