import { createHash } from 'node:crypto'

export interface CampaignRecipient { addressId: string; partyId?: string; propertyRef?: string; eligibility: 'eligible' | 'excluded' | 'needs_review' }
export interface CampaignReview { audienceSnapshotId: string; playbookVersionId: string; config: Record<string, unknown>; recipients: CampaignRecipient[] }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value)
}

/** Hashes the frozen review scope; it is not a provider idempotency key. */
export function campaignReviewHash(review: CampaignReview): string {
  return createHash('sha256').update(stable({ ...review, recipients: [...review.recipients].sort((a, b) => a.addressId.localeCompare(b.addressId)) })).digest('hex')
}

export function prepareCampaignPublication(review: CampaignReview, suppliedHash: string) {
  const expectedHash = campaignReviewHash(review)
  if (suppliedHash !== expectedHash) throw new CampaignPublicationError('REVIEW_CHANGED')
  const eligible = review.recipients.filter((recipient) => recipient.eligibility === 'eligible')
  const duplicates = eligible.filter((recipient, index) => eligible.findIndex((other) => other.addressId === recipient.addressId) !== index)
  if (duplicates.length > 0) throw new CampaignPublicationError('DUPLICATE_ADDRESS')
  if (eligible.length === 0) throw new CampaignPublicationError('NO_ELIGIBLE_RECIPIENTS')
  return { reviewHash: expectedHash, recipients: eligible }
}

export function duplicateCampaignDraft<T extends Record<string, unknown>>(draft: T): T {
  const copy = structuredClone(draft) as Record<string, unknown>
  delete copy.activeVersionId
  delete copy.executionState
  delete copy.historicalEligibility
  return structuredClone(copy) as T
}

export class CampaignPublicationError extends Error { constructor(public readonly code: 'REVIEW_CHANGED' | 'DUPLICATE_ADDRESS' | 'NO_ELIGIBLE_RECIPIENTS') { super(code) } }
