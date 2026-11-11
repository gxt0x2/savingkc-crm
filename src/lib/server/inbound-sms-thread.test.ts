import { describe, expect, it } from 'vitest'

import { conversationDeepLinkSearch, conversationMatchesDeepLink } from '@/lib/queries/conversation-hub'
import { conversationThreadKey } from '@/lib/server/conversation-read-model-contract'

import { inboundConversationTarget, inboundSmsInboxRow, isTeamCompanyLineSender } from './inbound-sms-thread'

const ERNEST_PERSONAL = '+18162262552'
const ERNEST_COMPANY = '+18166088588'

describe('inbound conversation thread target', () => {
  it('opens an unmatched phone thread from the notification deep link', () => {
    const target = inboundConversationTarget(null, ERNEST_PERSONAL)
    expect(target).toEqual({
      threadId: `unmatched:${ERNEST_PERSONAL}`,
      href: `/conversation/unmatched:${ERNEST_PERSONAL}`,
      url: `/conversations?lead=${encodeURIComponent(`unmatched:${ERNEST_PERSONAL}`)}`,
    })
    expect(target.url).not.toBe('/conversations')
    expect(target.threadId).not.toBe('')

    const requested = new URL(`https://crm.savingkc.com${target.url}`).searchParams.get('lead')
    expect(requested).toBe(`unmatched:${ERNEST_PERSONAL}`)
    expect(conversationDeepLinkSearch(requested)).toBe(`phone:${ERNEST_PERSONAL}`)
    expect(conversationThreadKey(requested!)).toBe(`phone:${ERNEST_PERSONAL}`)
    expect(conversationMatchesDeepLink({
      id: `unmatched:${ERNEST_PERSONAL}`,
      threadKey: `phone:${ERNEST_PERSONAL}`,
    }, requested!)).toBe(true)
  })

  it('keeps a resolved seller on that lead thread', () => {
    expect(inboundConversationTarget('11111111-1111-4111-8111-111111111111', '+19137179716')).toMatchObject({
      threadId: '11111111-1111-4111-8111-111111111111',
      href: '/conversation/11111111-1111-4111-8111-111111111111',
    })
  })

  it('gives a team text to the company line an inbox row and hides coordination', () => {
    expect(isTeamCompanyLineSender(ERNEST_PERSONAL)).toBe(true)
    const primary = {
      lead_id: null,
      activity_type: 'sms',
      description: 'Sent a photo',
      metadata: {
        direction: 'received',
        from: ERNEST_PERSONAL,
        to: ERNEST_COMPANY,
        team_sender: true,
        num_media: 1,
      },
    }
    expect(inboundSmsInboxRow(primary)).toEqual({
      visible: true,
      threadId: `unmatched:${ERNEST_PERSONAL}`,
      threadKey: `phone:${ERNEST_PERSONAL}`,
    })
    expect(inboundSmsInboxRow({
      lead_id: null,
      activity_type: 'sms',
      description: 'Internal coordination',
      metadata: { direction: 'internal', from: ERNEST_PERSONAL, to: ERNEST_COMPANY, is_team: true },
    })).toEqual({ visible: false, threadId: null, threadKey: null })
    expect(inboundSmsInboxRow({
      ...primary,
      lead_id: 'fb16d1bd-0000-4000-8000-000000000000',
      metadata: { ...primary.metadata, is_team: true },
    }).visible).toBe(false)
  })
})
