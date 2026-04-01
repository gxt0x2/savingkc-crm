import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { deepMerge } from '@/lib/manifest-sync'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/manifests/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

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

    // Fetch existing manifest
    const { data: existing, error: fetchError } = await supabase
      .from('manifests')
      .select('manifest')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Manifest not found' },
        { status: 404 }
      )
    }

    const currentManifest = existing.manifest as ManifestV2

    // Deep merge updates into manifest (preserves nested sibling keys)
    const { agent: _agent, action: _action, details: _details, ...manifestUpdates } = updates
    const updatedManifest: ManifestV2 = deepMerge(currentManifest, manifestUpdates)
    updatedManifest.lastUpdated = new Date().toISOString()
    updatedManifest.lastUpdatedBy = updates.agent || 'system'
    updatedManifest.auditTrail = [
      ...(currentManifest.auditTrail || []),
      {
        timestamp: new Date().toISOString(),
        agent: updates.agent || 'system',
        action: updates.action || 'manifest_updated',
        details: updates.details,
      },
    ]
    // Mark briefing stale on any manifest update
    if (!updatedManifest.ariIntelligence) updatedManifest.ariIntelligence = {}
    updatedManifest.ariIntelligence.briefingStale = true

    // Update in Supabase
    const { data, error } = await supabase
      .from('manifests')
      .update({
        manifest: updatedManifest,
        current_station: updatedManifest.currentStation,
        priority: updatedManifest.priority,
        tier: updatedManifest.tier,
        qualification_score: updatedManifest.qualificationScore,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, manifest')
      .single()

    if (error) {
      console.error('Manifest update error:', error)
      return NextResponse.json(
        { error: 'Failed to update manifest' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      manifest: data.manifest,
    })
  } catch (err) {
    console.error('Manifest PATCH error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
