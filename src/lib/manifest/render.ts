import { createClient } from '@supabase/supabase-js'
import { manifestV2_1Schema, type ManifestId } from './schema'
import { renderPreCallBriefing } from './render.preCall'

export type RenderIntent =
  | 'pre_call_briefing'
  | 'post_call_disposition'
  | 'hot_opportunity_eval'
  | 'daily_chief_of_staff'

export interface RenderOptions {
  /** Reserved. Source hydration (calls/emails) lands in Phase 7. Default false. */
  hydrate_sources?: boolean
  /** Max tokens. Serializer trims low-value sections until it fits. Default 1500. */
  token_budget?: number
  /** For testing: freeze the clock. */
  now?: Date
}

export class ManifestNotFoundError extends Error {
  constructor(public readonly manifestId: string) {
    super(`Manifest not found: ${manifestId}`)
    this.name = 'ManifestNotFoundError'
  }
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Bridge between stored manifest and Ari's context window. Reads the
 * manifest, parses through the V2.1 Zod schema, and dispatches to the
 * intent-specific renderer. Only `pre_call_briefing` is implemented —
 * other intents are specified separately once this one proves out.
 *
 * Pure: no writes. Reads manifests only. Deterministic given inputs + now.
 */
export async function renderManifestForAri(
  manifestId: ManifestId | string,
  intent: RenderIntent,
  options: RenderOptions = {},
): Promise<string> {
  const supabase = getSupabase()
  const { data: row, error } = await supabase
    .from('manifests')
    .select('manifest')
    .eq('id', manifestId)
    .single()

  if (error || !row) {
    throw new ManifestNotFoundError(manifestId as string)
  }

  const manifest = manifestV2_1Schema.parse(row.manifest)

  switch (intent) {
    case 'pre_call_briefing':
      return renderPreCallBriefing(manifest, options)
    case 'post_call_disposition':
    case 'hot_opportunity_eval':
    case 'daily_chief_of_staff':
      throw new Error(`Render intent not yet implemented: ${intent}`)
  }
}
