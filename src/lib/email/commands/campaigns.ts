import { prepareCampaignPublication, type CampaignReview } from '../campaigns'

/** Server command handlers call this after deriving workspace/actor and loading a frozen snapshot. */
export function validateCampaignLaunch(review: CampaignReview, draftHash: string, audienceHash: string) {
  if (audienceHash !== review.audienceSnapshotId) throw new Error('AUDIENCE_SNAPSHOT_CHANGED')
  return prepareCampaignPublication(review, draftHash)
}
