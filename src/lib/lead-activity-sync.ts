import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'

export type LeadActivityMutation = 'updated' | 'deleted'

interface SyncLeadActivityMutationInput {
  leadId: string
  activityId: string
  activityType: string
  mutation: LeadActivityMutation
}

/**
 * Keep the manifest/briefing projection current after a timeline activity is
 * edited or deleted. This deliberately calls the domain layer directly: an
 * internal HTTP request would have to impersonate the browser session and can
 * silently fail when route authorization changes.
 */
export async function syncLeadActivityMutation({
  leadId,
  activityId,
  activityType,
  mutation,
}: SyncLeadActivityMutationInput): Promise<boolean> {
  const manifestId = await ensureManifestExists(leadId)
  if (!manifestId) return false

  return updateManifestAndCascade(leadId, (manifest) => {
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true

    if (!manifest.auditTrail) manifest.auditTrail = []
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: `activity:${activityType}`,
      action: `activity_${mutation}`,
      details: {
        activityId,
        activityType,
      },
    })
  }, `activity:${mutation}`)
}
