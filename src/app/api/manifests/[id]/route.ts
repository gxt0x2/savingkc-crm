import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { deepMerge, updateManifestV2_1, ManifestWriteError } from '@/lib/manifest-sync'
import { legacyManifestJson, recordLegacyManifestApiUse } from '@/lib/server/legacy-manifest-api'

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
  const unauthorized = await requireAuthenticatedUser()
  if (unauthorized) return unauthorized
  recordLegacyManifestApiUse('GET', '/api/manifests/[id]')
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
      return legacyManifestJson(
        { error: 'Manifest not found' },
        { status: 404 }
      )
    }

    return legacyManifestJson({ manifest: data })
  } catch (err) {
    console.error('Manifest GET error:', err)
    return legacyManifestJson(
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
  const actor = await resolveAuthenticatedActor()
  if (!actor) return legacyManifestJson({ error: 'Unauthorized' }, { status: 401 })
  recordLegacyManifestApiUse('PATCH', '/api/manifests/[id]')
  try {
    const { id } = await params
    const updates = await req.json() as Record<string, unknown>
    const supabase = getSupabase()

    // Fetch existing manifest + lead_id for cascade
    const { data: existing, error: fetchError } = await supabase
      .from('manifests')
      .select('manifest, lead_id')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return legacyManifestJson(
        { error: 'Manifest not found' },
        { status: 404 }
      )
    }

    const currentManifest = existing.manifest as ManifestV2

    const manifestUpdates = { ...updates }
    delete manifestUpdates.agent
    delete manifestUpdates.action
    delete manifestUpdates.details
    const action = 'legacy_manifest_updated'

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
    merged.auditTrail = [
      ...(currentManifest.auditTrail ?? []),
      {
        timestamp: new Date().toISOString(),
        agent: actor.name,
        action,
      },
    ]
    merged.ariIntelligence = {
      ...(currentManifest.ariIntelligence ?? {}),
      briefingStale: true,
    }
    merged.lastUpdated = new Date().toISOString()
    merged.lastUpdatedBy = actor.name

    // Hand every top-level key as a subtree. The RPC shallow-replaces each
    // one against the current stored value; manifest.manifest.* can't form.
    const subtrees: Record<string, unknown> = {}
    for (const key of Object.keys(merged)) {
      subtrees[key] = merged[key]
    }

    try {
      const nextManifest = await updateManifestV2_1({
        manifestId: id,
        subtrees,
        actor: actor.name,
        reason: action,
      })

      if (!nextManifest) {
        return legacyManifestJson({ error: 'Manifest not found' }, { status: 404 })
      }

      return legacyManifestJson({ success: true, manifest: nextManifest })
    } catch (err) {
      if (err instanceof ManifestWriteError) {
        return legacyManifestJson(
          { error: 'Manifest write failed', detail: err.message },
          { status: 500 },
        )
      }
      throw err
    }
  } catch (err) {
    console.error('Manifest PATCH error:', err)
    return legacyManifestJson(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
