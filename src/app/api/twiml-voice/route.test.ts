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

async function outboundTwiml(identity: string, requestedCallerId?: string) {
  const body = new FormData()
  body.set('CallSid', 'CA_test_outbound')
  body.set('From', `client:${identity}`)
  body.set('To', '+18165550199')
  if (requestedCallerId) body.set('CallerId', requestedCallerId)
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

describe('outbound TwiML agent identity', () => {
  it('defaults Ernest to his canonical company line', async () => {
    const twiml = await outboundTwiml('ernest')

    expect(twiml).toContain('callerId="+18166088588"')
    expect(twiml).toContain('identity=ernest')
  })

  it('defaults Casey to her canonical company line', async () => {
    const twiml = await outboundTwiml('casey')

    expect(twiml).toContain('callerId="+18167277667"')
    expect(twiml).toContain('identity=casey')
  })

  it('ignores an unapproved caller ID instead of leaking it to Twilio', async () => {
    const twiml = await outboundTwiml('ernest', '+18165550999')

    expect(twiml).toContain('callerId="+18166088588"')
    expect(twiml).not.toContain('+18165550999')
  })
})
