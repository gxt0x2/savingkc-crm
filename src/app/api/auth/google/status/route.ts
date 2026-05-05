export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasGoogleOAuthConfig } from '@/lib/gmail-sync'

// GET /api/auth/google/status — list connected Google accounts
export async function GET() {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('user_oauth_tokens')
    .select('user_email, last_sync_at, created_at, scope')
    .eq('provider', 'google')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    accounts: data || [],
    oauthConfigured: hasGoogleOAuthConfig(),
  })
}
