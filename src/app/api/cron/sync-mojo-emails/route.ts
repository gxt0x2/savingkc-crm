export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { syncUserMojoEmails } from '@/lib/mojo-email-sync'

// GET /api/cron/sync-mojo-emails
// Pulls Mojo notification emails from connected Gmail accounts and queues
// actionable records into mojo_call_queue. This is a fallback/backup path for
// Mojo session-cookie sync, not a replacement for full call-recording sync.
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const daysBack = Number(url.searchParams.get('days_back') || process.env.MOJO_EMAIL_SYNC_DAYS_BACK || 7)
  const maxResults = Number(url.searchParams.get('max_results') || process.env.MOJO_EMAIL_SYNC_MAX_RESULTS || 50)
  const requestedUser = url.searchParams.get('user_email')?.trim().toLowerCase()

  const db = supabaseAdmin()
  let query = db
    .from('user_oauth_tokens')
    .select('user_email')
    .eq('provider', 'google')

  if (requestedUser) {
    query = query.eq('user_email', requestedUser)
  }

  const { data: tokens, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!tokens || tokens.length === 0) {
    return NextResponse.json({ message: 'No connected Google accounts', results: [] })
  }

  const results = []
  for (const token of tokens) {
    const result = await syncUserMojoEmails(token.user_email, daysBack, maxResults)
    results.push(result)
  }

  const totals = results.reduce(
    (acc, result) => ({
      scanned: acc.scanned + result.scanned,
      queued: acc.queued + result.queued,
      skipped: acc.skipped + result.skipped,
      failed: acc.failed + result.failed,
    }),
    { scanned: 0, queued: 0, skipped: 0, failed: 0 }
  )

  return NextResponse.json({
    results,
    total_users: tokens.length,
    ...totals,
  })
}
