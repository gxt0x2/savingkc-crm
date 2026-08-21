import { describe, expect, it } from 'vitest'
import {
  InvalidEntityConflictCursorError,
  maskEntityConflictValue,
  normalizeEntityConflictLimit,
  parseEntityConflictCursor,
} from './crm-entity-conflicts'

describe('CRM entity conflict read contract', () => {
  it('caps page size and applies a stable default', () => {
    expect(normalizeEntityConflictLimit(null)).toBe(20)
    expect(normalizeEntityConflictLimit('0')).toBe(20)
    expect(normalizeEntityConflictLimit('12')).toBe(12)
    expect(normalizeEntityConflictLimit('500')).toBe(50)
  })

  it('accepts only timestamp and UUID keyset cursors', () => {
    const cursor = Buffer.from(JSON.stringify({
      detectedAt: '2026-08-21T12:34:56.000Z',
      id: '229280e0-0e74-4fff-a2c2-e6f970e82525',
    })).toString('base64url')

    expect(parseEntityConflictCursor(cursor)).toEqual({
      detectedAt: '2026-08-21T12:34:56.000Z',
      id: '229280e0-0e74-4fff-a2c2-e6f970e82525',
    })
    expect(() => parseEntityConflictCursor('not-a-cursor')).toThrow(InvalidEntityConflictCursorError)
  })

  it('does not return full normalized contact values to the browser', () => {
    expect(maskEntityConflictValue('phone', '+14699213485')).toBe('•••3485')
    expect(maskEntityConflictValue('email', 'seller@example.com')).toBe('•••@example.com')
    expect(maskEntityConflictValue(null, null)).toBeNull()
  })
})
