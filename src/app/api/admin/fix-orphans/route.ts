import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * One-time fix: create leads for orphaned manifests (lead_id = null).
 * These came from the Mojo backfill where lead creation failed due to
 * the leads_source_check constraint rejecting 'mojo:unknown'.
 *
 * GET /api/admin/fix-orphans — run the fix
 */
export async function GET() {
  // 1. Check what values the constraint allows
  const { data: constraintInfo } = await supabase.rpc('exec_sql', {
    sql: `SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname = 'leads_source_check'`
  }).maybeSingle()

  // 2. Fetch all orphaned manifests
  const { data: orphans, error } = await supabase
    .from('manifests')
    .select('id, manifest, current_station, priority')
    .is('lead_id', null)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!orphans?.length) {
    return NextResponse.json({ message: 'No orphaned manifests found', constraintInfo })
  }

  let created = 0
  let failed = 0
  const errors: string[] = []

  for (const orphan of orphans) {
    const m = orphan.manifest as Record<string, unknown>
    const contact = m?.contact as Record<string, string> | undefined
    const property = m?.property as Record<string, string> | undefined
    const owner = m?.owner as Record<string, string> | undefined

    // Build lead name from manifest
    const fullName = owner?.name || contact?.name || (m?.contactName as string) || 'Mojo Lead'
    const phone = contact?.phone || (m?.phone as string) || null
    const address = property?.address || null
    const city = property?.city || null
    const state = property?.state || null
    const zip = property?.zip || null

    // Try 'mojo_dialer' first, fall back to 'inbound_call' if constraint rejects it
    let leadId: string | null = null

    for (const source of ['mojo_dialer', 'inbound_call']) {
      const { data: newLead, error: insertErr } = await supabase
        .from('leads')
        .insert({
          full_name: fullName,
          phone,
          property_address: address,
          city,
          state,
          zip,
          source,
          station: orphan.current_station || 'intake',
          priority: orphan.priority || 'normal',
        })
        .select('id')
        .single()

      if (newLead) {
        leadId = newLead.id
        break
      }

      if (insertErr && !insertErr.message.includes('source_check')) {
        errors.push(`Manifest ${orphan.id}: ${insertErr.message}`)
        break
      }
    }

    if (leadId) {
      // Link manifest to lead
      await supabase
        .from('manifests')
        .update({ lead_id: leadId })
        .eq('id', orphan.id)
      created++
    } else {
      failed++
    }
  }

  return NextResponse.json({
    total_orphans: orphans.length,
    leads_created: created,
    failed,
    errors: errors.slice(0, 20),
    constraintInfo,
  })
}
