import { NextRequest, NextResponse } from 'next/server'
import { ensureManifestExists } from '@/lib/manifest-sync'

/**
 * POST /api/leads/ensure-manifest
 * Ensures a manifest exists for a lead (creates if missing)
 * Used by appointment modal before updating manifest
 */
export async function POST(req: NextRequest) {
  try {
    const { leadId } = await req.json()

    if (!leadId) {
      return NextResponse.json(
        { error: 'leadId required' },
        { status: 400 }
      )
    }

    // Create manifest if it doesn't exist
    const manifestId = await ensureManifestExists(leadId)

    return NextResponse.json({
      success: true,
      manifestId,
      created: !!manifestId,
    })
  } catch (err) {
    console.error('ensure-manifest error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
