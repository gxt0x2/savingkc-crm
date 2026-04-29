export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'

const templateSchema = z.object({
  slug: z.string().min(2).optional(),
  title: z.string().min(1),
  template_type: z.enum(['email', 'document', 'checklist']),
  audience: z.enum(['buyer', 'seller', 'title', 'internal']),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
  sort_order: z.number().int().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const audience = searchParams.get('audience')
    const templateType = searchParams.get('template_type')

    let query = supabaseAdmin()
      .from('tc_document_templates')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (audience && audience !== 'all') query = query.eq('audience', audience)
    if (templateType && templateType !== 'all') query = query.eq('template_type', templateType)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ templates: data ?? [] })
  } catch (err) {
    console.error('[tc/document-templates GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = templateSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const slug = parsed.data.slug ||
      parsed.data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    const { data, error } = await supabaseAdmin()
      .from('tc_document_templates')
      .insert({
        ...parsed.data,
        slug,
        sort_order: parsed.data.sort_order ?? 500,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ template: data }, { status: 201 })
  } catch (err) {
    console.error('[tc/document-templates POST] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
