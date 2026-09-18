import { describe, expect, it } from 'vitest'
import { formatPhone } from './format'

describe('CRM phone presentation', () => {
  it.each(['8167177667', '+18167177667', '1-816-717-7667', '816.717.7667', '(816) 717-7667'])('formats %s consistently', phone => {
    expect(formatPhone(phone)).toBe('(816) 717-7667')
  })
  it('preserves actual digits and unsupported international numbers', () => {
    expect(formatPhone('+18167277667')).toBe('(816) 727-7667')
    expect(formatPhone('+442079460958')).toBe('+442079460958')
    expect(formatPhone(null)).toBe('')
    expect(formatPhone(undefined)).toBe('')
  })
})
