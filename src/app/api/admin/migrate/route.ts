import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ADMIN_SECRET = process.env.CRON_SECRET || process.env.DEPLOY_SECRET

export async function POST(req: Request) {
  // Auth check
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret') || req.headers.get('x-admin-secret')
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: string[] = []

  // Create push_subscriptions table
  const { error: pushErr } = await supabase.from('push_subscriptions').select('id').limit(1)
  if (pushErr && pushErr.code === 'PGRST205') {
    // Table doesn't exist — create it via insert/upsert won't work for DDL
    // Use supabase.rpc if available, otherwise log that manual creation is needed
    results.push('push_subscriptions: table needs manual creation via Supabase SQL editor')
  } else if (pushErr) {
    results.push(`push_subscriptions: error - ${pushErr.message}`)
  } else {
    results.push('push_subscriptions: exists')
  }

  // Create system_config table
  const { error: sysErr } = await supabase.from('system_config').select('key').limit(1)
  if (sysErr && sysErr.code === 'PGRST205') {
    results.push('system_config: table needs manual creation via Supabase SQL editor')
  } else if (sysErr) {
    results.push(`system_config: error - ${sysErr.message}`)
  } else {
    results.push('system_config: exists')
  }

  return NextResponse.json({ results })
}
