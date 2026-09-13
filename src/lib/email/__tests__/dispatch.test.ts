import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { liveDispatchBlockReason } from '../dispatch/service'
import { createDispatchWorkerHttp } from '../dispatch/worker-http'
import { listUnsubscribeHeaders } from '../preferences/service'
import { isDeliveryEvent, isDiagnosticEvent } from '../inbound/reduce'

describe('remote dispatch fencing', () => {
  it('never treats an env flag as controlled provider evidence', () => {
    expect(liveDispatchBlockReason()).toBe('LIVE_DISPATCH_DISABLED')
    expect(
      liveDispatchBlockReason({
        enabledEnv: 'true',
        sendEnabled: true,
        evidenceEnv: 'true',
      }),
    ).toBe('CONTROLLED_PROVIDER_EVIDENCE_REQUIRED')
    expect(
      liveDispatchBlockReason({
        enabledEnv: 'true',
        sendEnabled: false,
        evidenceEnv: 'true',
      }),
    ).toBe('WORKSPACE_PAUSED')
  })
  it('keeps the dispatch worker disabled until its own secret is configured', async () => {
    const process = async () => ({ state: 'held', processed: 1, reason: 'LIVE_DISPATCH_DISABLED' })
    const run = createDispatchWorkerHttp({
      database: () => {
        throw new Error('must not query')
      },
      enabled: () => false,
      secret: () => 'fixture-dispatch-bearer-at-least-32-characters',
      ownerId: () => '11111111-1111-4111-8111-111111111111',
      process,
    })
    const disabled = await run(
      new Request('http://localhost/api/workers/email/dispatch', {
        headers: {
          Authorization:
            'Bearer fixture-dispatch-bearer-at-least-32-characters',
        },
      }),
    )
    expect(await disabled.json()).toEqual({
      state: 'disabled',
      processed: 0,
      liveSend: false,
    })
  })
})

describe('simulated unsubscribe headers and delivery classification', () => {
  it('stores List-Unsubscribe as a relative or configured public URL', () => {
    const token = '1.' + 'x'.repeat(43)
    expect(listUnsubscribeHeaders(token)).toEqual({
      'List-Unsubscribe': `</api/email/unsubscribe/${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })
  it('reduces delivery facts and treats opens as diagnostics', () => {
    expect(isDeliveryEvent('email.bounced')).toBe(true)
    expect(isDeliveryEvent('email.received')).toBe(false)
    expect(isDiagnosticEvent('email.opened')).toBe(true)
  })
})
