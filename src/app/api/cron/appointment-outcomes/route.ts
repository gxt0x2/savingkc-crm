import { NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { listOverdueScheduledAppointments } from '@/lib/server/overdue-appointment-outcomes'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store' }

async function handle(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  const result = await listOverdueScheduledAppointments(supabaseAdmin(), { limit: 50 })
  if (result.error) {
    return NextResponse.json({ ok: false, readOnly: true, error: 'Overdue appointments could not be read' }, { status: 500, headers: HEADERS })
  }
  return NextResponse.json({
    ok: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    cutoff: result.cutoff,
    count: result.rows.length,
    appointments: result.rows,
  }, { headers: HEADERS })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
