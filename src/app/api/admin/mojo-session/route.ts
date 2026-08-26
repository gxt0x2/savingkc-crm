/**
 * POST /api/admin/mojo-session
 * Set Mojo session ID for recording downloads.
 * Body: { sessionId: string }
 *
 * GET /api/admin/mojo-session
 * Check if session is configured (doesn't return the actual value).
 */
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'



export async function GET(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    // Try to read from system_config
    const { data, error } = await supabase
      .from('system_config')
      .select('key, updated_at')
      .eq('key', 'mojo_session_id')
      .single()

    if (error) {
      return NextResponse.json({ configured: false, error: 'Table or key not found', details: error.message })
    }

    return NextResponse.json({
      configured: true,
      updatedAt: data.updated_at,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not read Mojo session status'
    return NextResponse.json({ configured: false, error: message })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { sessionId, secret } = body

    const unauthorized = await requireAdminOrSecret(req, [secret])
    if (unauthorized) return unauthorized

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
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
      return NextResponse.json({ error: error.message, hint: 'system_config table may not exist. Create it manually in Supabase.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Mojo session saved' })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not save Mojo session'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
