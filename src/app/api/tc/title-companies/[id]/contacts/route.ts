export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const { data, error } = await supabaseAdmin()
      .from('title_contacts')
      .insert({
        title_company_id: id,
        name: String(body.name).trim(),
        role: body.role || null,
        email: body.email || null,
        phone: body.phone || null,
        is_primary: Boolean(body.is_primary),
        notes: body.notes || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ contact: data }, { status: 201 })
  } catch (err) {
    console.error('[tc/title-companies/:id/contacts POST] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
