export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin()
      .from('title_companies')
      .select('*, contacts:title_contacts(*)')
      .order('preferred', { ascending: false })
      .order('name', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ companies: data ?? [] })
  } catch (err) {
    console.error('[tc/title-companies GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const { data, error } = await supabaseAdmin()
      .from('title_companies')
      .insert({
        name: String(body.name).trim(),
        office_phone: body.office_phone || null,
        office_email: body.office_email || null,
        address: body.address || null,
        preferred: Boolean(body.preferred),
        notes: body.notes || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ company: data }, { status: 201 })
  } catch (err) {
    console.error('[tc/title-companies POST] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
