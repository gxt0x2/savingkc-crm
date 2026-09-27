import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUserEmail } from '@/lib/auth/admin'
import { parseWholesaleMarketSnapshot, WholesaleMarketSnapshotError } from '@/lib/market-watch/snapshot'
import { supabase } from '@/lib/supabase-lazy'

export async function POST(request: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canUploadMarketSnapshot(email))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Market snapshot must be JSON' }, { status: 400 })
  }

  try {
    const snapshot = parseWholesaleMarketSnapshot(body)
    const { error } = await supabase.from('wholesale_market_snapshots').upsert({
      month_key: snapshot.meta.month_key,
      payload: body,
      uploaded_by: email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'month_key' })
    if (error) return NextResponse.json({ error: 'The snapshot was not saved' }, { status: 500 })
    return NextResponse.json({
      ok: true,
      month_key: snapshot.meta.month_key,
      month: snapshot.meta.month,
      fit_zip_count: snapshot.summary.fit_zip_count,
    })
  } catch (error) {
    const message = error instanceof WholesaleMarketSnapshotError ? error.message : 'Market snapshot was rejected'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

async function canUploadMarketSnapshot(email: string): Promise<boolean> {
  const { data } = await supabase
    .from('agent_profiles')
    .select('role, is_admin')
    .eq('email', email)
    .maybeSingle()
  return Boolean(data?.is_admin || data?.role === 'owner')
}
