export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()

  // Fetch lead + manifest in parallel
  const [leadRes, manifestRes] = await Promise.all([
    db.from('leads')
      .select('*')
      .eq('id', id)
      .single(),
    db.from('manifests')
      .select('manifest')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (leadRes.error || !leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lead = leadRes.data as any
  return NextResponse.json({
    ...lead,
    manifest: (manifestRes.data as any)?.manifest?.manifest ?? null,
  })
}
