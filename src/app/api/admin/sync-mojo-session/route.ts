/**
 * POST /api/admin/sync-mojo-session
 * Stores a Mojo session id in Supabase.
 *
 * Vercel cannot read the local Mac's ~/.openclaw session file. Keep this route
 * explicit so production builds do not trace arbitrary local filesystem paths.
 */
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

export async function POST(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const body = await req.json().catch(() => ({}))
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

  if (!sessionId) {
    return NextResponse.json({
      success: false,
      message: 'Missing sessionId. Extract it on the Mac, then POST { "sessionId": "..." } to this route.',
    }, { status: 400 })
  }

  // Upsert the session (system_config table must exist)
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'mojo_session_id',
      value: sessionId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({
      success: false,
      message: `Failed to store in Supabase: ${error.message}`,
    })
  }

  return NextResponse.json({
    success: true,
    sessionPrefix: sessionId.substring(0, 10) + '...',
    details: ['Session stored in Supabase system_config'],
  })
}
