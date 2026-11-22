import { describe, expect, it } from 'vitest'
import { parseNumberChannelEdit } from './number-channels'

describe('number channel edits', () => {
  it('normalizes the number and accepts known channels', () => {
    expect(parseNumberChannelEdit({ number: '(816) 608-8770', channel: 'direct_mail', campaign: ' Nov drop ' }))
      .toEqual({ number: '+18166088770', channel: 'direct_mail', campaign: 'Nov drop', note: null })
  })
  it('treats an empty channel as clearing it', () => {
    expect(parseNumberChannelEdit({ number: '+18166088770', channel: '' })?.channel).toBeNull()
  })
  it('rejects unknown channels and bad numbers', () => {
    expect(parseNumberChannelEdit({ number: '+18166088770', channel: 'google_ads' })).toBeNull()
    expect(parseNumberChannelEdit({ number: '12345', channel: 'signs' })).toBeNull()
    expect(parseNumberChannelEdit(null)).toBeNull()
  })
})
