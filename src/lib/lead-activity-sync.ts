import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'

export type LeadActivityMutation = 'updated' | 'deleted'

interface SyncLeadActivityCreatedInput {
  leadId: string
  activityId: string
  activityType: string
  description: string
  actorName: string
}

interface SyncLeadActivityMutationInput {
  leadId: string
  activityId: string
  activityType: string
  mutation: LeadActivityMutation
}

/** Keep the compatibility manifest current after the source-of-truth activity commits. */
export async function syncLeadActivityCreated({
  leadId,
  activityId,
  activityType,
  description,
  actorName,
}: SyncLeadActivityCreatedInput): Promise<boolean> {
  const manifestId = await ensureManifestExists(leadId)
  if (!manifestId) return false

  return updateManifestAndCascade(leadId, (manifest) => {
    if (activityType === 'note') {
      if (!manifest.agentNotes) manifest.agentNotes = []
      manifest.agentNotes.push({
        timestamp: new Date().toISOString(),
        author: actorName,
        source: 'manual_note',
        content: description,
      })
    }

    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true

    if (!manifest.auditTrail) manifest.auditTrail = []
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: actorName,
      action: 'activity_created',
      details: { activityId, activityType },
    })
  }, 'activity:created')
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
