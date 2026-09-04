import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { recordMojoHealthIncident } from '@/lib/server/mojo-health-incident'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

const IncidentSchema = z.object({
  message: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(100),
  source: z.string().trim().min(1).max(100),
  sessionStatus: z.string().trim().max(50).nullish(),
  syncHealth: z.string().trim().max(50).nullish(),
  lastSyncAt: z.string().datetime().nullish(),
}).strict()

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const parsed = IncidentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid Mojo incident payload' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const result = await recordMojoHealthIncident(supabaseAdmin(), parsed.data)
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'mojo_incident_record_failed',
      error: error instanceof Error ? error.message : String(error),
    }))
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Mojo incident could not be recorded' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
