import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { deepMerge } from '@/lib/manifest-sync'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET /api/manifests/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('manifests')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Manifest fetch error:', error)
      return NextResponse.json(
        { error: 'Manifest not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ manifest: data })
  } catch (err) {
    console.error('Manifest GET error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH /api/manifests/[id] - Update manifest
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const updates = await req.json()
    const supabase = getSupabase()

    // Fetch existing manifest + lead_id for cascade
    const { data: existing, error: fetchError } = await supabase
      .from('manifests')
      .select('manifest, lead_id')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Manifest not found' },
        { status: 404 }
      )
    }

    const currentManifest = existing.manifest as ManifestV2
    const leadId = (existing as any).lead_id as string

    // Deep merge updates and use updateManifestAndCascade
    const { agent: _agent, action: _action, details: _details, ...manifestUpdates } = updates

    const { updateManifestAndCascade } = await import('@/lib/manifest-sync')

    const cascaded = await updateManifestAndCascade(leadId, (manifest: any) => {
      // Apply deep merge
      const merged = deepMerge(manifest, manifestUpdates)
      Object.assign(manifest, merged)

      manifest.lastUpdated = new Date().toISOString()
      manifest.lastUpdatedBy = updates.agent || 'system'

      if (!manifest.auditTrail) manifest.auditTrail = []
      manifest.auditTrail.push({
        timestamp: new Date().toISOString(),
        agent: updates.agent || 'system',
        action: updates.action || 'manifest_updated',
        details: updates.details,
      })

      if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
      manifest.ariIntelligence.briefingStale = true
    }, updates.agent || 'api:manifests_patch')

    if (!cascaded) {
      return NextResponse.json({ error: 'Manifest not found' }, { status: 404 })
    }

    // Fetch and return updated manifest
    const { data: result } = await supabase
      .from('manifests').select('manifest').eq('id', id).single()

    return NextResponse.json({ success: true, manifest: result?.manifest })
  } catch (err) {
    console.error('Manifest PATCH error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
