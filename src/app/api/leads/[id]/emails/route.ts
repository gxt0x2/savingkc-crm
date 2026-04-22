export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/leads/:id/emails — list emails synced for this lead
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('lead_emails')
    .select('*')
    .eq('lead_id', id)
    .order('sent_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ emails: data || [] })
}
