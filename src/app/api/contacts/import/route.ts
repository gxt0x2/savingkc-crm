import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ProspectImportError, parseProspectImportRows } from '@/lib/server/prospect-import-command'

export async function POST(request: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rows: ReturnType<typeof parseProspectImportRows>
  let campaignId: string | null = null
  try {
    const body = await request.json() as { rows?: unknown; campaignId?: unknown }
    rows = parseProspectImportRows(body)
    if (body.campaignId !== undefined && body.campaignId !== null && body.campaignId !== '') {
      if (typeof body.campaignId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.campaignId)) {
        return NextResponse.json({ error: 'Campaign is invalid' }, { status: 400 })
      }
      campaignId = body.campaignId
    }
  } catch (error) {
    if (error instanceof ProspectImportError) {
      return NextResponse.json({ error: error.message, row: error.row ?? null }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid import request' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const phones = rows.map((row) => row.phone)
  const phoneChunks = Array.from({ length: Math.ceil(phones.length / 100) }, (_, index) =>
    phones.slice(index * 100, index * 100 + 100),
  )
  const duplicateChecks = await Promise.all(phoneChunks.map((chunk) =>
    db.from('crm_contact_methods').select('normalized_value').eq('method_type', 'phone').in('normalized_value', chunk),
  ))
  if (duplicateChecks.some((result) => result.error)) {
    return NextResponse.json({ error: 'Existing contacts could not be checked' }, { status: 503 })
  }
  const existingCount = duplicateChecks.reduce((count, result) => count + (result.data?.length ?? 0), 0)
  if (existingCount > 0) {
    return NextResponse.json({
      error: `${existingCount} phone number${existingCount === 1 ? '' : 's'} already exist in the CRM. Remove existing contacts before importing.`,
      existing: existingCount,
    }, { status: 409 })
  }

  const batchId = crypto.randomUUID()
  if (campaignId) {
    const importRows = rows.map((row) => ({ id: crypto.randomUUID(), ...row }))
    const { data, error } = await db.rpc('import_prospecting_campaign_members_v1', {
      p_campaign_id: campaignId,
      p_actor_email: actor.email,
      p_actor_name: actor.name,
      p_batch_id: batchId,
      p_rows: importRows,
    })
    if (error || !data) {
      const detail = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
      if (detail.includes('campaign_not_found')) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
      }
      if (detail.includes('campaign_members_locked')) {
        return NextResponse.json({ error: 'Pause the campaign before changing its audience' }, { status: 409 })
      }
      if (detail.includes('prospect_import_existing_contact') || detail.includes('23505')) {
        return NextResponse.json({ error: 'A phone number already exists in the CRM. Refresh the prospect list and try again.' }, { status: 409 })
      }
      console.error('[contacts/import] atomic campaign import failed', error)
      return NextResponse.json({ error: 'No contacts were imported or added to the campaign' }, { status: 503 })
    }
    return NextResponse.json({ success: true, ...data }, { status: 201 })
  }

  const { data: inserted, error: insertError } = await db
    .from('leads')
    .insert(rows)
    .select('id')
  if (insertError || !inserted || inserted.length !== rows.length) {
    console.error('[contacts/import] atomic lead insert failed', insertError)
    return NextResponse.json({ error: 'No contacts were imported' }, { status: 500 })
  }

  const { error: activityError } = await db.from('lead_activities').insert(inserted.map((lead) => ({
    lead_id: lead.id,
    activity_type: 'status_change',
    description: 'Prospect imported from CSV',
    agent: actor.name,
    metadata: {
      source: 'contact_csv_import',
      action: 'import_prospect',
      import_batch_id: batchId,
    },
  })))

  return NextResponse.json({
    success: true,
    imported: inserted.length,
    batchId,
    ...(activityError
      ? { warning: 'Contacts were imported, but the import audit timeline could not be completed.' }
      : {}),
  }, { status: 201 })
}
