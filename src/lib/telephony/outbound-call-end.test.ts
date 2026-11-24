import { describe, expect, it } from 'vitest'
import {
  classifyOutboundDialResult,
  createOutboundEndLatch,
  hangupMustRequireDisposition,
  twilioCallIsClosed,
} from './sequential-outbound-call'

const call = (status: string) => ({ status: () => status, disconnect: () => {} })

describe('classifyOutboundDialResult', () => {
  it('labels a call that never rang as hangup_before_ring', () => {
    expect(classifyOutboundDialResult({ accepted: false, rang: false })).toBe('hangup_before_ring')
  })
  it('keeps rang-but-unanswered as no_answer', () => {
    expect(classifyOutboundDialResult({ accepted: false, rang: true })).toBe('no_answer')
  })
  it('accepted calls are connected', () => {
    expect(classifyOutboundDialResult({ accepted: true, rang: true })).toBe('connected')
  })
})

describe('createOutboundEndLatch', () => {
  it('lets only the first of error/disconnect/cancel finish the call', () => {
    const endOnce = createOutboundEndLatch()
    expect(endOnce()).toBe(true)
    expect(endOnce()).toBe(false)
    expect(endOnce()).toBe(false)
  })
})

describe('hangupMustRequireDisposition (simulated call error then Hang Up)', () => {
  it('requires the outcome when Twilio already closed the call and an attempt is open', () => {
    expect(hangupMustRequireDisposition({ call: call('closed'), activeAttemptId: 'att-1' })).toBe(true)
  })
  it('lets the normal disconnect event handle a live call', () => {
    expect(hangupMustRequireDisposition({ call: call('open'), activeAttemptId: 'att-1' })).toBe(false)
  })
  it('does not open the outcome while connect() is still pending', () => {
    expect(hangupMustRequireDisposition({ call: null, activeAttemptId: 'att-1' })).toBe(false)
  })
  it('does nothing once the attempt outcome is saved', () => {
    expect(hangupMustRequireDisposition({ call: call('closed'), activeAttemptId: null })).toBe(false)
  })
})

describe('twilioCallIsClosed', () => {
  it('tolerates objects without status() or that throw', () => {
    expect(twilioCallIsClosed({})).toBe(false)
    expect(twilioCallIsClosed(null)).toBe(false)
    expect(twilioCallIsClosed({ status: () => { throw new Error('x') } })).toBe(false)
  })
})
