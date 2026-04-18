import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { deepMerge, updateManifestV2_1, ManifestWriteError } from '@/lib/manifest-sync'

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

    const { agent: _agent, action: _action, details: _details, ...manifestUpdates } = updates
    const agent = updates.agent || 'system'

    // Deep-merge the caller's partial updates into the current manifest in TS
    // to preserve the endpoint's historical API contract (callers can send
    // partial nested payloads). The merged result is then handed to
    // updateManifestV2_1 as discrete top-level subtrees — the RPC does a
    // shallow per-subtree replacement at the DB layer, which is what kills
    // the self-nesting bug class. No deep merge happens inside the write path.
    const merged = deepMerge(currentManifest, manifestUpdates) as ManifestV2 & Record<string, unknown>

    // Maintain the legacy auditTrail append until Phase 7 extracts history
    // out of the manifest into manifest_history. Until then, both audit
    // channels run in parallel — manifest.auditTrail for the UI that reads
    // it today, manifest_history for the new audit infrastructure.
    const merged2 = merged as any
    merged2.auditTrail = [
      ...(currentManifest.auditTrail ?? []),
      {
        timestamp: new Date().toISOString(),
        agent,
        action: updates.action || 'manifest_updated',
        details: updates.details,
      },
    ]
    merged2.ariIntelligence = {
      ...(currentManifest.ariIntelligence ?? {}),
      briefingStale: true,
    }
    merged2.lastUpdated = new Date().toISOString()
    merged2.lastUpdatedBy = agent

    // Hand every top-level key as a subtree. The RPC shallow-replaces each
    // one against the current stored value; manifest.manifest.* can't form.
    const subtrees: Record<string, unknown> = {}
    for (const key of Object.keys(merged2)) {
      subtrees[key] = merged2[key]
    }

    try {
      const nextManifest = await updateManifestV2_1({
        manifestId: id,
        subtrees,
        actor: agent,
        reason: updates.action || 'api:manifests_patch',
      })

      if (!nextManifest) {
        return NextResponse.json({ error: 'Manifest not found' }, { status: 404 })
      }

      return NextResponse.json({ success: true, manifest: nextManifest })
    } catch (err) {
      if (err instanceof ManifestWriteError) {
        return NextResponse.json(
          { error: 'Manifest write failed', detail: err.message },
          { status: 500 },
        )
      }
      throw err
    }
  } catch (err) {
    console.error('Manifest PATCH error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
