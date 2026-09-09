import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { isConfiguredCrmMcpActorEmail } from '@/lib/mcp/auth'
import { isAllowedCrmMcpRedirectUri } from '@/lib/mcp/oauth'
import { createClient } from '@/lib/supabase/server'

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: PRIVATE_NO_STORE })
}

export async function POST(request: Request) {
  const requestOrigin = new URL(request.url).origin
  const suppliedOrigin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if ((suppliedOrigin && suppliedOrigin !== requestOrigin) || (fetchSite && fetchSite !== 'same-origin')) {
    return errorResponse('Invalid request origin', 403)
  }

  const formData = await request.formData()
  const decision = formData.get('decision')
  const authorizationId = formData.get('authorization_id')
  if (
    (decision !== 'approve' && decision !== 'deny') ||
    typeof authorizationId !== 'string' ||
    !authorizationId.trim() ||
    authorizationId.length > 1024
  ) {
    return errorResponse('Invalid authorization decision', 400)
  }

  const actor = await resolveAuthenticatedActor()
  if (!actor || !isConfiguredCrmMcpActorEmail(actor.email)) {
    return errorResponse('Unauthorized', 403)
  }

  const supabase = await createClient()
  const { data: authorization, error: detailsError } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
  if (detailsError || !authorization || !('authorization_id' in authorization)) {
    return errorResponse('Authorization request expired', 400)
  }

  if (
    authorization.user.email.trim().toLowerCase() !== actor.email ||
    !isAllowedCrmMcpRedirectUri(authorization.redirect_uri)
  ) {
    return errorResponse('Connector callback is not allowed', 403)
  }

  const result = decision === 'approve'
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })

  if (result.error || !result.data?.redirect_url) {
    return errorResponse(result.error?.message || 'Authorization failed', 400)
  }

  return NextResponse.redirect(result.data.redirect_url, 303)
}
