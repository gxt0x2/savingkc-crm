export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  COMMUNICATION_TEMPLATE_CATALOG,
  communicationTemplateBySlug,
  type CommunicationTemplateDepartment,
} from '@/lib/operating-model/communication-template-catalog'

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

    const query = supabaseAdmin()
      .from('tc_document_templates')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    const { data, error } = await query
    if (error) console.warn('[tc/document-templates GET] custom template storage unavailable; serving governed catalog', error.message)

    const storedTemplates = error ? [] : (data ?? [])
    const savedBySlug = new Map(storedTemplates.map((template) => [template.slug, template]))
    const systemSlugs = new Set(COMMUNICATION_TEMPLATE_CATALOG.map((template) => template.slug))
    const systemTemplates = COMMUNICATION_TEMPLATE_CATALOG.map((definition) => {
      const saved = savedBySlug.get(definition.slug)
      return saved
        ? { ...saved, ...definition, persisted_id: saved.id, system: true }
        : { ...definition, system: true }
    })
    const customTemplates = storedTemplates
      .filter((template) => !systemSlugs.has(template.slug))
      .map((template) => ({
        ...template,
        department: 'closing_coordination' as CommunicationTemplateDepartment,
        phase_id: 'custom',
        task_type: '',
        workflow_id: 'disposition-operating-lifecycle',
        source: 'archive',
        source_label: 'Custom CRM template',
        catalog: false,
        system: false,
      }))

    const templates = [...systemTemplates, ...customTemplates]
      .filter((template) => !audience || audience === 'all' || template.audience === audience)
      .filter((template) => !templateType || templateType === 'all' || template.template_type === templateType)
      .sort((left, right) => (left.sort_order ?? 500) - (right.sort_order ?? 500))

    return NextResponse.json({
      templates,
      ...(error ? { storage_warning: 'Custom template storage is temporarily unavailable. Governed system standards remain available.' } : {}),
    })
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

    if (communicationTemplateBySlug(slug)) {
      return NextResponse.json({ error: 'That slug belongs to a governed system template. Choose a different title or slug.' }, { status: 409 })
    }

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
