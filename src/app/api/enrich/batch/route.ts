import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forceReenrichLead } from '@/lib/auto-enrich'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BATCH_SIZE = 3 // concurrent leads per batch (county scrapers are slow)
/**
 * POST /api/enrich/batch — Force re-enrich all leads
 *
 * Auth: Bearer $CRON_SECRET
 *
 * Runs prospect lookup + county assessor on every lead with an address or phone,
 * OVERWRITING existing data. Updates manifests, re-scores, marks ARI stale,
 * and cascades housing details to leads table.
 *
 * Body options:
 *   { "all": true }            — re-enrich ALL leads with manifests
 *   { "leadIds": ["id1",...] } — re-enrich specific leads
 *   { "dry_run": true }        — just return count of leads that would be processed
 */
export async function POST(req: NextRequest) {
  // Auth check
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()

    // Fetch leads to process
    let leadIds: string[] = []

    if (body.leadIds && Array.isArray(body.leadIds)) {
      leadIds = body.leadIds
    } else if (body.all) {
      // Get all leads that have a manifest AND have an address or phone
      const { data: manifests } = await supabase
        .from('manifests')
        .select('lead_id')

      if (!manifests || manifests.length === 0) {
        return NextResponse.json({ ok: true, message: 'No manifests found', total: 0 })
      }

      const manifestLeadIds = manifests.map(m => m.lead_id).filter(Boolean)

      // Fetch those leads that have address or phone
      const { data: leads } = await supabase
        .from('leads')
        .select('id, phone, property_address')
        .in('id', manifestLeadIds)
        .or('phone.neq.,property_address.neq.')

      leadIds = (leads || [])
        .filter(l => l.phone || l.property_address)
        .map(l => l.id)
    } else {
      return NextResponse.json(
        { error: 'Provide { all: true } or { leadIds: [...] }' },
        { status: 400 },
      )
    }

    if (body.dry_run) {
      return NextResponse.json({ ok: true, dry_run: true, total: leadIds.length })
    }

    // Process in batches
    const results: Array<{ leadId: string; success: boolean; prospectMatch: boolean; countyEnriched: boolean; error?: string }> = []
    let processed = 0

    for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
      const batch = leadIds.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.allSettled(
        batch.map(async (leadId) => {
          const r = await forceReenrichLead(leadId)
          return { leadId, ...r }
        })
      )

      for (const settled of batchResults) {
        if (settled.status === 'fulfilled') {
          results.push(settled.value)
        } else {
          results.push({
            leadId: batch[processed % BATCH_SIZE] || 'unknown',
            success: false,
            prospectMatch: false,
            countyEnriched: false,
            error: settled.reason?.message || 'Unknown error',
          })
        }
        processed++
      }
    }

    const succeeded = results.filter(r => r.success).length
    const prospectMatches = results.filter(r => r.prospectMatch).length
    const countyEnriched = results.filter(r => r.countyEnriched).length
    const failed = results.filter(r => !r.success)

    return NextResponse.json({
      ok: true,
      total: leadIds.length,
      succeeded,
      prospectMatches,
      countyEnriched,
      failedCount: failed.length,
      failures: failed.slice(0, 20), // Cap failure details at 20
    })
  } catch (err: any) {
    console.error('[enrich/batch] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    )
  }
}
