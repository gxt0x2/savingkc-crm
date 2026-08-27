import { NextRequest, NextResponse } from 'next/server'

import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { countyEnrichmentFacts } from '@/lib/auto-enrich'
import { CountyEnrichmentService, type EnrichmentInput } from '@/lib/county-enrichment'
import { recordCanonicalPropertyEnrichment } from '@/lib/server/crm-property-enrichment'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CanonicalEnrichmentInput = EnrichmentInput & {
  lead_id?: unknown
  manifest_id?: unknown
  forceRefresh?: unknown
  force_refresh?: unknown
}

// POST /api/enrich — enrich the canonical property linked to a lead.
export async function POST(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json() as CanonicalEnrichmentInput
    if (!body.address || !body.state || !body.county) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: address, state, county',
      }, { status: 400 })
    }
    if (typeof body.lead_id !== 'string' || !UUID_PATTERN.test(body.lead_id)) {
      return NextResponse.json({
        success: false,
        error: body.manifest_id
          ? 'Manifest enrichment is retired. Provide the canonical lead_id.'
          : 'A valid lead_id is required.',
        replacement: 'lead_id',
      }, { status: body.manifest_id ? 410 : 400 })
    }

    const service = new CountyEnrichmentService()
    const forceRefresh = body.forceRefresh === true || body.force_refresh === true
    const result = await service.enrich(body, forceRefresh)
    if (!result.success) return NextResponse.json(result)

    try {
      const canonical = await recordCanonicalPropertyEnrichment({
        leadId: body.lead_id,
        source: 'county_assessor',
        sourceReference: result.source || `${body.county}:${body.state}`,
        facts: countyEnrichmentFacts(result, body),
        observedAt: result.fetchedAt,
      })
      return NextResponse.json({ ...result, canonical })
    } catch (error) {
      console.error('[enrich] Canonical property save failed:', error)
      return NextResponse.json({
        success: false,
        error: 'County data was retrieved but could not be saved to the canonical property.',
      }, { status: 503 })
    }
  } catch (error) {
    console.error('[enrich] Request failed:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
