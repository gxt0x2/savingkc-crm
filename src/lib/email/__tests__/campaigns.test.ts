import { describe, expect, it } from 'vitest'
import { campaignReviewHash, duplicateCampaignDraft, prepareCampaignPublication } from '../campaigns'

const review = { audienceSnapshotId: 'snapshot-1', playbookVersionId: 'playbook-1', config: { dailyLimit: 25, mode: 'draft_only' }, recipients: [{ addressId: 'address-1', eligibility: 'eligible' as const }, { addressId: 'address-2', eligibility: 'excluded' as const }] }
describe('immutable campaign publication', () => {
  it('binds an exact review hash and publishes only eligible recipients', () => expect(prepareCampaignPublication(review, campaignReviewHash(review)).recipients).toEqual([review.recipients[0]]))
  it('rejects changed review scope and duplicate active addresses', () => {
    expect(() => prepareCampaignPublication(review, 'stale')).toThrow('REVIEW_CHANGED')
    const duplicate = { ...review, recipients: [review.recipients[0], { ...review.recipients[0] }] }
    expect(() => prepareCampaignPublication(duplicate, campaignReviewHash(duplicate))).toThrow('DUPLICATE_ADDRESS')
  })
  it('copies a draft without execution or historical eligibility', () => expect(duplicateCampaignDraft({ name: 'Pilot', activeVersionId: 'v1', executionState: 'active', historicalEligibility: 12, dailyLimit: 25 })).toEqual({ name: 'Pilot', dailyLimit: 25 }))
})
