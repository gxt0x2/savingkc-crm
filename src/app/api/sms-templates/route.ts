/**
 * SMS Templates API
 * GET /api/sms-templates - List all active templates
 * GET /api/sms-templates?category=ghost_protocol - Filter by category
 * POST /api/sms-templates - Create or update a reusable SMS template by name
 */

import { NextResponse } from 'next/server'
import { getAllTemplates, getTemplatesByCategory } from '@/lib/sms-templates'
import { supabase } from '@/lib/supabase-lazy'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')

    const templates = category
      ? await getTemplatesByCategory(category)
      : await getAllTemplates()

    return NextResponse.json({ templates })
  } catch (err) {
    console.error('SMS templates API error:', err)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const category = typeof body?.category === 'string' ? body.category.trim() : 'intro'
    const templateBody = typeof body?.body === 'string' ? body.body.trim() : ''
    const mergeFields = Array.isArray(body?.merge_fields)
      ? Array.from(new Set(
          body.merge_fields
            .filter((field: unknown): field is string => typeof field === 'string' && field.trim().length > 0)
            .map((field: string) => field.trim()),
        ))
      : []

    if (!name || !templateBody) {
      return NextResponse.json({ error: 'Template name and body are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('sms_templates')
      .upsert({
        name,
        category,
        body: templateBody,
        merge_fields: mergeFields,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'name' })
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ template: data })
  } catch (err) {
    console.error('SMS templates POST error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save template' }, { status: 500 })
  }
}
