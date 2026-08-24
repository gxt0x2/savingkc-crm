import { NextRequest, NextResponse } from 'next/server'
import { forceReenrichLead } from '@/lib/auto-enrich'
import { supabase } from '@/lib/supabase-lazy'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

const BATCH_SIZE = 3 // concurrent leads per batch (county scrapers are slow)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/**
 * POST /api/enrich/batch — Force re-enrich all leads
 *
 * Auth: Bearer $CRON_SECRET
 *
 * Runs prospect lookup + county assessor on every lead with an address or phone,
 * OVERWRITING the typed facts returned by those providers. Every successful
 * source is persisted to the canonical property with durable provenance.
 *
 * Body options:
 *   { "all": true }            — re-enrich all eligible leads (capped at 5,000)
 *   { "leadIds": ["id1",...] } — re-enrich specific leads
 *   { "dry_run": true }        — just return count of leads that would be processed
 */
export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json()

    // Fetch leads to process
    let leadIds: string[] = []

    if (body.leadIds && Array.isArray(body.leadIds)) {
      if (body.leadIds.length > 5_000) {
        return NextResponse.json({ error: 'Explicit leadIds exceed the 5,000-record safety cap.' }, { status: 409 })
      }
      leadIds = body.leadIds.filter((id: unknown): id is string => typeof id === 'string' && UUID_PATTERN.test(id))
      if (leadIds.length !== body.leadIds.length) {
        return NextResponse.json({ error: 'Every leadId must be a valid UUID.' }, { status: 400 })
      }
      leadIds = Array.from(new Set(leadIds))
    } else if (body.all) {
      const { data: leads, error } = await supabase
        .from('leads')
        .select('id, phone, property_address')
        .or('phone.not.is.null,property_address.not.is.null')
        .limit(5_001)

      if (error) return NextResponse.json({ error: 'Eligible leads could not be loaded.' }, { status: 503 })
      if ((leads || []).length > 5_000) {
        return NextResponse.json({
          error: 'The all-leads enrichment scope exceeds the 5,000-record safety cap. Provide explicit leadIds.',
        }, { status: 409 })
      }

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
  } catch (err: unknown) {
    console.error('[enrich/batch] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
