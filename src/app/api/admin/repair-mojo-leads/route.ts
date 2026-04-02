import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Repair empty "Mojo Lead" / "Unknown" records by backfilling from their manifests.
 * GET /api/admin/repair-mojo-leads?dry=true  (preview what would change)
 * GET /api/admin/repair-mojo-leads            (actually fix them)
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dry') === 'true'

  // Find all leads with empty/placeholder names from Mojo
  const { data: emptyLeads, error } = await supabase
    .from('leads')
    .select('id, full_name, phone, property_address, source')
    .in('full_name', ['Mojo Lead', 'Unknown', ''])
    .eq('source', 'mojo_call')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!emptyLeads || emptyLeads.length === 0) {
    return NextResponse.json({ message: 'No empty Mojo leads found', repaired: 0 })
  }

  const results: any[] = []
  let repaired = 0
  let noManifest = 0

  for (const lead of emptyLeads) {
    // Find manifest for this lead
    const { data: manifests } = await supabase
      .from('manifests')
      .select('id, manifest')
      .eq('lead_id', lead.id)
      .limit(1)

    if (!manifests || manifests.length === 0) {
      noManifest++
      results.push({ leadId: lead.id, status: 'no_manifest' })
      continue
    }

    const m = manifests[0].manifest as any
    const updates: Record<string, any> = {}

    // Extract name from manifest
    const manifestName = m?.owner?.fullName
    if (manifestName && manifestName !== 'Unknown' && manifestName.trim()) {
      updates.full_name = manifestName
    } else {
      // Try to extract from contacts or agent notes
      const contacts = m?.contacts || []
      for (const c of contacts) {
        if (c.name && c.role !== 'agent' && c.name !== 'Unknown') {
          updates.full_name = c.name
          break
        }
      }
    }

    // Extract phone from manifest
    if (!lead.phone) {
      const phones = m?.owner?.phones || []
      if (phones.length > 0 && phones[0]) {
        updates.phone = phones[0]
      }
    }

    // Extract address from manifest
    if (!lead.property_address) {
      const addr = m?.property?.address
      if (addr && addr.trim()) {
        updates.property_address = addr
      }
    }

    // Extract city/state/zip
    if (m?.property?.city) updates.city = m.property.city
    if (m?.property?.state) updates.state = m.property.state
    if (m?.property?.zip) updates.zip = m.property.zip

    if (Object.keys(updates).length === 0) {
      results.push({ leadId: lead.id, status: 'no_data_in_manifest', currentName: lead.full_name })
      continue
    }

    if (!dryRun) {
      await supabase.from('leads').update(updates).eq('id', lead.id)
    }

    repaired++
    results.push({
      leadId: lead.id,
      status: dryRun ? 'would_repair' : 'repaired',
      before: { name: lead.full_name, phone: lead.phone, address: lead.property_address },
      after: updates,
    })
  }

  return NextResponse.json({
    dryRun,
    total: emptyLeads.length,
    repaired,
    noManifest,
    noData: emptyLeads.length - repaired - noManifest,
    results,
  })
}
