import { NextRequest, NextResponse } from 'next/server'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { resolveMobileScopedActor } from '@/lib/mobile-api/authorized-lead'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

const PROJECT_ID = '16f48d2e-418b-4c62-a287-5e16cbd79244'
const EXPO_TOKEN = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/

export async function POST(request: NextRequest) {
  const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: mobileNoStoreHeaders() })
  try {
    const { user } = await requireMobileUser(request)
    const email = user.email?.trim().toLowerCase()
    if (!email || !await resolveMobileScopedActor(email)) return json({ error: 'CRM profile not authorized' }, 403)
    const body = await request.json().catch(() => null)
    if (!body || typeof body.token !== 'string' || !EXPO_TOKEN.test(body.token)
      || !['ios', 'android'].includes(body.platform)
      || (body.projectId !== undefined && body.projectId !== PROJECT_ID)) {
      return json({ error: 'A valid Saving KC Expo device token and platform are required' }, 400)
    }
    // Unique token/project makes retries idempotent and prevents duplicate delivery.
    // The bearer subject is authoritative; caller-supplied user IDs are ignored.
    const { error } = await supabaseAdmin().from('mobile_push_devices').upsert({
      project_id: PROJECT_ID,
      token: body.token,
      user_id: user.id,
      platform: body.platform,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id,token' })
    if (error) return json({ error: 'Device registration could not be saved. Retry when available.' }, 503)
    // Registration is not remote delivery or Twilio VoIP credential readiness.
    return json({ ok: true, registered: true, deliveryConfigured: false })
  } catch (error) {
    return json({ error: error instanceof MobileAuthError ? error.message : 'Device registration is temporarily unavailable' }, error instanceof MobileAuthError ? error.status : 503)
  }
}
