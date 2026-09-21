export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { REQUIRED_GOOGLE_OAUTH_SCOPES } from '@/lib/google-oauth-scopes'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'

// Restricted-scope verification: request only the APIs this CRM calls.
// gmail.modify is unused — sync is users.messages.list/get, send is
// users.messages.send, appointments use Calendar. Do not add modify back
// without a user-facing mailbox-mutation feature.

// GET /api/auth/google/authorize?return_to=/settings
// Redirects the user to Google OAuth consent screen.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const returnTo = url.searchParams.get('return_to') || '/settings'
  const origin = url.origin
  const errorUrl = new URL(returnTo, origin)

  const actor = await resolveAuthenticatedActor(req)
  if (!actor?.email) {
    errorUrl.searchParams.set('oauth_error', 'not_authenticated')
    return NextResponse.redirect(errorUrl)
  }
  const crmEmail = actor.email.trim().toLowerCase()

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    errorUrl.searchParams.set('oauth_error', 'google_oauth_not_configured')
    return NextResponse.redirect(errorUrl)
  }

  const redirectUri = `${origin}/api/auth/google/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: REQUIRED_GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: Buffer.from(JSON.stringify({ return_to: returnTo, crm_email: crmEmail })).toString('base64url'),
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
