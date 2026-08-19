import { createHash } from 'node:crypto'

/**
 * Produce a stable UUID-shaped primary key for a provider event.
 *
 * lead_activities uses UUID primary keys, so assigning the same ID to every
 * retry lets Postgres close the race between two serverless instances without
 * adding a second persistence system just for webhook receipts.
 */
export function stableWebhookActivityId(scope: string, providerKey: string): string {
  const digest = createHash('sha256')
    .update(`savingkc-telephony:${scope}:${providerKey}`)
    .digest('hex')
    .slice(0, 32)
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-')
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505',
  )
}
