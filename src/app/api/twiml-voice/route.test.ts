import { describe, expect, it } from 'vitest'
import { POST } from './route'

async function inboundTwiml(to: string) {
  const body = new FormData()
  body.set('CallSid', 'CA_test_inbound')
  body.set('From', '+18165550199')
  body.set('To', to)
  const response = await POST(new Request('https://crm.savingkc.com/api/twiml-voice', {
    method: 'POST',
    body,
  }))
  return response.text()
}

describe('inbound TwiML identity routing', () => {
  it('routes the dispositions number directly to Ernest without the seller IVR', async () => {
    const twiml = await inboundTwiml('+18166088858')

    expect(twiml).toContain('<Dial')
    expect(twiml).toContain('callerId="+18166088858"')
    expect(twiml).toContain('+18162262552')
    expect(twiml).toContain('type=direct')
    expect(twiml).not.toContain('<Gather')
  })

  it('routes Casey Legacy directly to Casey without the seller IVR', async () => {
    const twiml = await inboundTwiml('+18163754666')

    expect(twiml).toContain('<Dial')
    expect(twiml).toContain('callerId="+18163754666"')
    expect(twiml).toContain('+18167564943')
    expect(twiml).toContain('type=direct')
    expect(twiml).not.toContain('<Gather')
  })

  it('keeps standard acquisition numbers on the seller IVR', async () => {
    const twiml = await inboundTwiml('+18163077835')

    expect(twiml).toContain('<Gather')
    expect(twiml).toContain('/api/ivr/handle-input')
  })
})
