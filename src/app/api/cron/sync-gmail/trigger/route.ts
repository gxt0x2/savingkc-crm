export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { syncUserGmail } from '@/lib/gmail-sync'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { getCurrentUserEmail, isCurrentUserAdmin } from '@/lib/auth/admin'

// POST /api/cron/sync-gmail/trigger { user_email, days_back? }
// Manually run a sync for one user.
export async function POST(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  const { user_email, days_back } = await req.json()
  if (!user_email) return NextResponse.json({ error: 'user_email required' }, { status: 400 })
  const requestedEmail = String(user_email).trim().toLowerCase()
  const currentEmail = await getCurrentUserEmail()

  if (currentEmail && requestedEmail !== currentEmail && !(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await syncUserGmail(requestedEmail, days_back || 7)
  return NextResponse.json(result)
}
