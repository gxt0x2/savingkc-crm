import { describe, expect, it } from 'vitest'
import { classifyJunkInboundSms } from './sms-junk-filter'

// Replay of the real 2026-11-04 Missouri REALTORS payload (link shortened).
const REALTORS_2026_11_04 = 'Missouri REALTORS: Your opinion matters! Share your views and help us to better represent you by taking a short survey and enter to win 1 of 5 $100 Visa gift cards. Responses are confidential: https://www.opinion-counts.com/jfe/form/SV_3e1sDtfYApdGRXE \r\nText STOP to quit'

describe('classifyJunkInboundSms', () => {
  it('flags the 2026-11-04 Missouri REALTORS survey blast', () => {
    expect(classifyJunkInboundSms(REALTORS_2026_11_04)).toEqual({ junk: true, reason: 'bulk_survey' })
  })

  it('flags vendor marketing with a bulk footer', () => {
    expect(classifyJunkInboundSms('ACME Roofing: 20% off this week only https://acme.example/x Reply STOP to opt out')).toMatchObject({ junk: true })
    expect(classifyJunkInboundSms('Enter to win a free inspection! Msg & data rates may apply. Reply HELP for help')).toMatchObject({ junk: true })
  })

  it('never flags a real seller text without a bulk footer', () => {
    expect(classifyJunkInboundSms('Hi, I got your letter about my house on Prospect Ave. What would you offer?')).toBeNull()
    expect(classifyJunkInboundSms('Here is the listing https://zillow.com/homedetails/123 can you take a look')).toBeNull()
    expect(classifyJunkInboundSms('Please stop texting me')).toBeNull()
    expect(classifyJunkInboundSms('STOP')).toBeNull()
    expect(classifyJunkInboundSms('')).toBeNull()
  })

  it('does not flag a footer alone with no marketing signal', () => {
    expect(classifyJunkInboundSms('ok thanks. text stop to quit')).toBeNull()
  })
})
