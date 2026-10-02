import { describe, expect, it } from 'vitest'

import { MAIN_SAVINGKC_CALLER_ID, resolveAgentTelephonyProfile } from './agent-identity'

describe('resolveAgentTelephonyProfile', () => {
  it('does not grant a roster identity to a substring or another email domain', () => {
    for (const email of ['noternest@savingkc.com', 'ernest@example.com', 'casey.other@savingkc.com']) {
      const profile = resolveAgentTelephonyProfile(email)
      expect(profile.hasDedicatedCallerId).toBe(false)
      expect(['ernest', 'casey', 'gertha']).not.toContain(profile.identity)
    }
  })
  it('defaults Ernest and Casey to their recorded company numbers', () => {
    expect(resolveAgentTelephonyProfile('ernest@savingkc.com')).toMatchObject({
      identity: 'ernest',
      displayName: 'Ernest',
      defaultCallerId: '+18166088588',
      hasDedicatedCallerId: true,
    })
    expect(resolveAgentTelephonyProfile('casey@savingkc.com')).toMatchObject({
      identity: 'casey',
      displayName: 'Casey',
      defaultCallerId: '+18167277667',
      hasDedicatedCallerId: true,
    })
  })

  it('keeps Gertha and unknown users on Main until a dedicated number is recorded', () => {
    expect(resolveAgentTelephonyProfile('gertha@savingkc.com')).toMatchObject({
      identity: 'gertha',
      displayName: 'Gertha',
      defaultCallerId: MAIN_SAVINGKC_CALLER_ID,
      hasDedicatedCallerId: false,
    })
    expect(resolveAgentTelephonyProfile('new.user@savingkc.com').defaultCallerId).toBe(MAIN_SAVINGKC_CALLER_ID)
  })
})
