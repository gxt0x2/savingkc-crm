import { describe, expect, it } from 'vitest'
import { isUniqueViolation, stableWebhookActivityId } from './webhook-idempotency'

describe('telephony webhook idempotency', () => {
  it('creates a stable, namespaced UUID for the same provider event', () => {
    const first = stableWebhookActivityId('twilio-call-status', 'CA123:completed')
    const retry = stableWebhookActivityId('twilio-call-status', 'CA123:completed')
    const differentStatus = stableWebhookActivityId('twilio-call-status', 'CA123:failed')

    expect(first).toBe(retry)
    expect(first).not.toBe(differentStatus)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('recognizes Postgres unique violations without masking other errors', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ code: '42501' })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
