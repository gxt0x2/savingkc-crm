import { describe, expect, it, vi } from 'vitest'
import { agentDialTwiml, BUSINESS_MENU_PROMPT, businessMenuTwiml, CECILY_VOICE, isBusinessLine, MENU_GATHER_TIMEOUT_SECONDS, menuVoice } from './business-line-ivr'

const base = { baseUrl: 'https://crm.savingkc.com', from: '+19137179716', callSid: 'CA1', calledNumber: '+18164292900' }

describe('business line call flow', () => {
  it('rings 15 s, then the Cecily menu offers 1, 2 and 9, waits 7 s, then retries instead of ending', () => {
    const xml = businessMenuTwiml({ ...base, attempt: 1 })
    expect(xml.indexOf('/api/audio/ring-15s.wav')).toBeGreaterThan(-1)
    expect(xml.indexOf('/api/audio/ring-15s.wav')).toBeLessThan(xml.indexOf('<Gather'))
    expect(xml).toContain(`<Say voice="${CECILY_VOICE}" language="en-US">${BUSINESS_MENU_PROMPT}`)
    expect(BUSINESS_MENU_PROMPT).toContain('press 2 to speak with a member of our team')
    expect(xml).toMatch(/press 1[\s\S]*press 2[\s\S]*press 9/)
    expect(xml).toContain(`timeout="${MENU_GATHER_TIMEOUT_SECONDS}"`)
    expect(xml).toContain('/api/ivr/business-menu?from=%2B19137179716&amp;callSid=CA1&amp;calledNumber=%2B18164292900&amp;attempt=2')
    expect(xml).not.toContain('<Hangup')
  })

  it('retry says staying on the line connects, then hands off to the team', () => {
    const xml = businessMenuTwiml({ ...base, attempt: 2 })
    expect(xml).toContain('stay on the line')
    expect(xml).not.toContain('ring-15s.wav')
    expect(xml).toContain('/api/ivr/no-input?from=%2B19137179716&amp;calledNumber=%2B18164292900')
    expect(xml).not.toContain('<Hangup')
  })

  it('rings apps and cells after announcing, for 30 s with apps and 25 s cells-only', () => {
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'true')
    const dial = { ...base, companyNumber: '+18166088588', leadId: 'lead-1', cells: ['+18162262552', '+18167564943'], announce: true }
    const withApps = agentDialTwiml({ ...dial, type: 'no_input', ringApps: true })
    expect(withApps.indexOf('Connecting you now')).toBeLessThan(withApps.indexOf('<Dial'))
    expect(withApps).toContain('timeout="30"')
    expect(withApps).toContain('<Identity>ernest</Identity>')
    expect(withApps).toContain('whisper?type=call')
    expect(withApps).toContain('type=no_input')
    const cellsOnly = agentDialTwiml({ ...dial, type: 'seller', ringApps: false, announce: false })
    expect(cellsOnly).toContain('timeout="25"')
    expect(cellsOnly).not.toContain('Connecting you now')
    vi.unstubAllEnvs()
  })

  it('IVR_VOICE swaps the voice without a code change', () => {
    expect(menuVoice({} as NodeJS.ProcessEnv)).toBe(CECILY_VOICE)
    expect(menuVoice({ IVR_VOICE: 'Polly.Joanna-Neural' } as unknown as NodeJS.ProcessEnv)).toBe('Polly.Joanna-Neural')
  })

  it('identifies the public business line', () => {
    expect(isBusinessLine('+18164292900')).toBe(true)
    expect(isBusinessLine('+18166088588')).toBe(false)
  })
})
