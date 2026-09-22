import { NextResponse } from 'next/server'
import { resolveOauthReviewSandboxLeadId } from '@/lib/auth/oauth-review-sandbox-session'
import { supabase } from '@/lib/supabase-lazy'

export async function GET(request: Request) {
  try {
    const sandboxLeadId = await resolveOauthReviewSandboxLeadId(request)
    let query = supabase
      .from('leads')
      .select('id, full_name, phone, source, created_at, station')
      .eq('priority', 'hot')
    if (sandboxLeadId) query = query.eq('id', sandboxLeadId)
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      return NextResponse.json({ leads: [] })
    }

    return NextResponse.json({ leads: data || [] })
  } catch {
    return NextResponse.json({ leads: [] })
  }
}
