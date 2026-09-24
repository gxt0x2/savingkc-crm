export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getCurrentUserEmail, isCurrentUserAdmin } from '@/lib/auth/admin'

// POST /api/auth/google/disconnect { user_email }
export async function POST(req: NextRequest) {
  const { user_email } = await req.json()
  if (!user_email) {
    return NextResponse.json({ error: 'user_email required' }, { status: 400 })
  }
  const requestedEmail = String(user_email).trim().toLowerCase()
  const currentEmail = await getCurrentUserEmail()

  if (!currentEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const { data: tokenRow, error: tokenLookupError } = await db
    .from('user_oauth_tokens')
    .select('crm_user_email')
    .eq('user_email', requestedEmail)
    .eq('provider', 'google')
    .maybeSingle()
  const missingLinkColumn = /crm_user_email/i.test(tokenLookupError?.message || '')
  if (tokenLookupError && !missingLinkColumn) {
    return NextResponse.json({ error: tokenLookupError.message }, { status: 500 })
  }
  const linkedCrm = typeof tokenRow?.crm_user_email === 'string'
    ? tokenRow.crm_user_email.trim().toLowerCase()
    : ''
  const ownsToken = requestedEmail === currentEmail || linkedCrm === currentEmail
  if (!ownsToken && !(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await db
    .from('user_oauth_tokens')
    .delete()
    .eq('user_email', requestedEmail)
    .eq('provider', 'google')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
