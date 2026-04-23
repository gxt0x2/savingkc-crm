export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// POST /api/auth/google/disconnect { user_email }
export async function POST(req: NextRequest) {
  const { user_email } = await req.json()
  if (!user_email) {
    return NextResponse.json({ error: 'user_email required' }, { status: 400 })
  }
  const db = supabaseAdmin()
  const { error } = await db
    .from('user_oauth_tokens')
    .delete()
    .eq('user_email', user_email)
    .eq('provider', 'google')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
