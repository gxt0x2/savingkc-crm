/**
 * SMS Templates API
 * GET /api/sms-templates - List all active templates
 * GET /api/sms-templates?category=ghost_protocol - Filter by category
 * POST /api/sms-templates - Create or update a reusable SMS template by name
 */

import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { getAllTemplates, getTemplatesByCategory } from '@/lib/sms-templates'
import { supabase } from '@/lib/supabase-lazy'

export const dynamic = 'force-dynamic'

const PRIVATE_NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(req: Request) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE_NO_STORE_HEADERS })

    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')

    const templates = category
      ? await getTemplatesByCategory(category)
      : await getAllTemplates()

    return NextResponse.json({ templates, actorName: actor.name.includes('@') ? null : actor.name }, { headers: PRIVATE_NO_STORE_HEADERS })
  } catch (err) {
    console.error('SMS templates API error:', err)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500, headers: PRIVATE_NO_STORE_HEADERS })
  }
}

export async function POST(req: Request) {
  try {
    const unauthorized = await requireAuthenticatedUser()
    if (unauthorized) return unauthorized

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
      return NextResponse.json({ error: 'Template name and body are required' }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS })
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
      return NextResponse.json({ error: error.message }, { status: 500, headers: PRIVATE_NO_STORE_HEADERS })
    }

    return NextResponse.json({ template: data }, { headers: PRIVATE_NO_STORE_HEADERS })
  } catch (err) {
    console.error('SMS templates POST error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save template' }, { status: 500, headers: PRIVATE_NO_STORE_HEADERS })
  }
}
