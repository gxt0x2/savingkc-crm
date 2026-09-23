import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: vi.fn(async () => true),
}))

import { POST } from './route'

const COMPANY_NAME = /saving\s*kc|savingkc|homebuyers/i
const COLD_GREETING = "Hey, sorry we missed you. Leave a message after the beep and we'll call you right back."

function request(query: string) {
  return new Request(`https://crm.savingkc.com/api/ivr/voicemail?${query}`, { method: 'POST' })
}

describe('cold callback voicemail greeting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('speaks the unbranded cold greeting instead of a recorded agent clip', async () => {
    const response = await POST(request('agent=Ernest&from=%2B18165550199&calledNumber=%2B18163100845'))
    const text = await response.text()

    expect(text).toContain(`<Say voice="Polly.Matthew">${COLD_GREETING}</Say>`)
    expect(text).not.toContain('<Play>')
    expect(text).not.toContain('ernest-vm.mp3')
    expect(text).not.toContain('casey-vm')
    expect(text).not.toMatch(COMPANY_NAME)
    expect(text).toContain('<Record ')
  })

  it('keeps the recorded greeting for standard inbound voicemail', async () => {
    const response = await POST(request('agent=Ernest&from=%2B18165550199&calledNumber=%2B18163077835'))
    const text = await response.text()

    expect(text).toContain('/audio/ernest-vm.mp3')
    expect(text).not.toContain(COLD_GREETING)
  })
})
