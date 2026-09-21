import { describe, expect, it } from 'vitest'
import {
  prospectingCallMatchesSession,
  queueItemCallContext,
} from './dialer-session-call-context'

const prospectSession = {
  currentSubjectKind: 'prospect',
  currentSubjectId: 'prospect-1',
  currentCampaignMemberId: 'member-1',
}

const leadSession = {
  currentSubjectKind: 'lead',
  currentSubjectId: 'lead-1',
  currentCampaignMemberId: 'member-2',
}

describe('prospectingCallMatchesSession', () => {
  it('allows a source Prospect call against the current campaign member', () => {
    expect(prospectingCallMatchesSession(prospectSession, {
      kind: 'prospect',
      leadId: null,
      prospectId: 'prospect-1',
      campaignMemberId: 'member-1',
    })).toBe(true)
  })

  it('allows a Lead-primary heir call against the current Lead member', () => {
    expect(prospectingCallMatchesSession(leadSession, {
      kind: 'heir',
      leadId: 'lead-1',
      prospectId: null,
      campaignMemberId: 'member-2',
    })).toBe(true)
  })

  it('rejects a leftover phone queue from a previous seller', () => {
    expect(prospectingCallMatchesSession(prospectSession, queueItemCallContext({
      leadId: 'lead-1',
      prospectId: null,
      prospect_phone_id: 'phone-1',
      campaignMemberId: 'member-2',
    }))).toBe(false)
    expect(prospectingCallMatchesSession(leadSession, {
      kind: 'prospect',
      leadId: null,
      prospectId: 'prospect-1',
      campaignMemberId: 'member-1',
    })).toBe(false)
  })

  it('rejects a matching subject with the wrong campaign member', () => {
    expect(prospectingCallMatchesSession(prospectSession, {
      kind: 'prospect',
      leadId: null,
      prospectId: 'prospect-1',
      campaignMemberId: null,
    })).toBe(false)
  })
})

describe('queueItemCallContext', () => {
  it('derives heir, lead, and source Prospect kinds from leftover phone rows', () => {
    expect(queueItemCallContext({
      leadId: 'lead-1',
      prospectId: null,
      prospect_phone_id: 'phone-1',
      campaignMemberId: 'member-2',
    })).toEqual({
      kind: 'heir',
      leadId: 'lead-1',
      prospectId: null,
      campaignMemberId: 'member-2',
    })
    expect(queueItemCallContext({
      leadId: 'lead-1',
      prospectId: null,
      prospect_phone_id: null,
      campaignMemberId: 'member-2',
    })).toEqual({
      kind: 'lead',
      leadId: 'lead-1',
      prospectId: null,
      campaignMemberId: 'member-2',
    })
    expect(queueItemCallContext({
      leadId: null,
      prospectId: 'prospect-1',
      prospect_phone_id: 'phone-1',
      campaignMemberId: 'member-1',
    })).toEqual({
      kind: 'prospect',
      leadId: null,
      prospectId: 'prospect-1',
      campaignMemberId: 'member-1',
    })
  })
})
