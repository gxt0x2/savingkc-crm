import { NextRequest, NextResponse } from 'next/server'
import { resolveOauthReviewSandboxLeadId } from '@/lib/auth/oauth-review-sandbox-session'
import { supabase } from '@/lib/supabase-lazy'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '8', 10)
  const limit = Math.min(Math.max(limitParam, 1), 20)

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const pattern = `%${q}%`
  const sandboxLeadId = await resolveOauthReviewSandboxLeadId(req)

  let query = supabase
    .from('leads')
    .select('id, full_name, phone, property_address, city, station, priority, updated_at')
    .or(`full_name.ilike.${pattern},phone.ilike.${pattern},property_address.ilike.${pattern}`)
  if (sandboxLeadId) query = query.eq('id', sandboxLeadId)
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[leads/search] error:', error)
    return NextResponse.json({ results: [], error: error.message }, { status: 500 })
  }

  return NextResponse.json({ results: data || [] })
}
