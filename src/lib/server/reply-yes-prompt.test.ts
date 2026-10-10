import { describe, expect, it, vi } from 'vitest'

import { inboundAnswersAutomatedYesPrompt, isAutomatedReplyYesPrompt, type ReplyYesPromptDb } from './reply-yes-prompt'

describe('automated Reply YES prompt', () => {
  it.each([
    'missed_call_auto',
    'cold_callback_auto_text',
    'missed_call_followup',
  ])('recognizes the %s auto-text', (trigger) => {
    expect(isAutomatedReplyYesPrompt({ direction: 'outbound', trigger })).toBe(true)
  })

  it('recognizes the missed-call unknown template', () => {
    expect(isAutomatedReplyYesPrompt({ template_name: 'missed_call_unknown' })).toBe(true)
  })

  it.each([
    { source: 'mobile_app', template_id: 'sms.conversation.1to1.v1', trigger: 'missed_call_auto' },
    { source: 'conversation_hub' },
    { source: 'heir_dialer' },
    { template_id: 'sms.conversation.1to1.v1' },
    { trigger: 'sms_sender_worker', template_name: 'intro' },
    { trigger: 'google_ads_missed_call_followup' },
    {},
    null,
  ])('leaves a human or unclassified outbound on the normal path: %j', (metadata) => {
    expect(isAutomatedReplyYesPrompt(metadata)).toBe(false)
  })
})

function promptDb(row: { id: string; metadata: Record<string, unknown>; lead_id?: string | null } | null, error?: { message: string }): ReplyYesPromptDb {
  return {
    from: () => ({
      select: () => {
        const filters: Array<[string, unknown]> = []
        const chain = {
          eq(column: string, value: string) {
            filters.push([column, value])
            return chain
          },
          in(column: string, value: readonly string[]) {
            filters.push([column, value])
            return chain
          },
          order() { return chain },
          limit() { return chain },
          maybeSingle: async () => {
            if (error) return { data: null, error }
            if (!row) return { data: null, error: null }
            const id = filters.find(([column]) => column === 'id')?.[1]
            if (id && id !== row.id) return { data: null, error: null }
            return { data: row, error: null }
          },
        }
        return chain
      },
    }),
  }
}

describe('inbound YES prompt lookup', () => {
  it('uses the matched outbound instead of a newer message', async () => {
    const db = promptDb({
      id: 'outbound-human',
      lead_id: 'lead-1',
      metadata: { source: 'mobile_app', template_id: 'sms.conversation.1to1.v1', direction: 'outbound' },
    })
    await expect(inboundAnswersAutomatedYesPrompt(db, {
      matchedOutboundActivityId: 'outbound-human',
      leadId: 'lead-1',
      customerPhone: '+18165550101',
    })).resolves.toBe(false)
  })

  it('accepts a matched missed-call text-back', async () => {
    const db = promptDb({
      id: 'outbound-auto',
      lead_id: 'lead-1',
      metadata: { trigger: 'missed_call_auto', direction: 'outbound' },
    })
    await expect(inboundAnswersAutomatedYesPrompt(db, {
      matchedOutboundActivityId: 'outbound-auto',
      leadId: 'lead-1',
      customerPhone: '+18165550101',
    })).resolves.toBe(true)
  })

  it('uses the latest outbound when the reply is not matched to one message', async () => {
    const db = promptDb({
      id: 'outbound-ivr',
      lead_id: 'lead-1',
      metadata: { trigger: 'cold_callback_auto_text', direction: 'outbound' },
    })
    await expect(inboundAnswersAutomatedYesPrompt(db, {
      matchedOutboundActivityId: null,
      leadId: 'lead-1',
      customerPhone: '+18165550101',
    })).resolves.toBe(true)
  })

  it('fails closed when the outbound lookup errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = promptDb(null, { message: 'lookup unavailable' })
    await expect(inboundAnswersAutomatedYesPrompt(db, {
      matchedOutboundActivityId: 'outbound-auto',
      leadId: 'lead-1',
      customerPhone: '+18165550101',
    })).resolves.toBe(false)
    errorSpy.mockRestore()
  })
})
