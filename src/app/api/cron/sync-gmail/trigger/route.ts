export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { syncUserGmail } from '@/lib/gmail-sync'

// POST /api/cron/sync-gmail/trigger { user_email, days_back? }
// Manually run a sync for one user.
export async function POST(req: NextRequest) {
  const { user_email, days_back } = await req.json()
  if (!user_email) return NextResponse.json({ error: 'user_email required' }, { status: 400 })
  const result = await syncUserGmail(user_email, days_back || 7)
  return NextResponse.json(result)
}
