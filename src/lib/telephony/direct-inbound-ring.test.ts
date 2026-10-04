import { describe, expect, it } from 'vitest'
import { directInboundClientIdentity, directInboundClientNoun } from './direct-inbound-ring'

describe('direct inbound Voice client', () => {
  it('rings Ernest on both company numbers without dropping the cell leg', () => {
    expect(directInboundClientIdentity('+18166088588')).toBe('ernest')
    expect(directInboundClientIdentity('+18166088858')).toBe('ernest')
    expect(directInboundClientNoun('(816) 608-8588')).toBe('<Client>ernest</Client>')
  })

  it('does not attach Ernest to Casey or the main IVR line', () => {
    expect(directInboundClientIdentity('+18167277667')).toBeNull()
    expect(directInboundClientIdentity('+18163754666')).toBeNull()
    expect(directInboundClientIdentity('+18163077835')).toBeNull()
    expect(directInboundClientNoun('+18167277667')).toBe('')
  })
})
