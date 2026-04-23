export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { syncUserGmail } from '@/lib/gmail-sync'

// GET /api/cron/sync-gmail — runs sync for every user with tokens
export async function GET(req: NextRequest) {
  // Optional cron-job.org secret check
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const db = supabaseAdmin()
  const { data: tokens } = await db
    .from('user_oauth_tokens')
    .select('user_email')
    .eq('provider', 'google')

  if (!tokens || tokens.length === 0) {
    return NextResponse.json({ message: 'No connected accounts', results: [] })
  }

  const results = []
  for (const t of tokens) {
    const result = await syncUserGmail(t.user_email, 7)
    results.push({ user_email: t.user_email, ...result })
  }

  return NextResponse.json({ results, total_users: tokens.length })
}
