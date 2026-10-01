import { describe, expect, it } from 'vitest'
import { twilioRecordingSid } from './twilio-recording'

const account = `AC${'a'.repeat(32)}`
const otherAccount = `AC${'b'.repeat(32)}`
const recording = `RE${'c'.repeat(32)}`

describe('stored Twilio recording source', () => {
  it('accepts a stored SID, relative CRM path, or exact Twilio account URL', () => {
    expect(twilioRecordingSid({ recordingSid: recording }, account)).toBe(recording)
    expect(twilioRecordingSid({ recordingUrl: `/api/recordings/${recording}` }, account)).toBe(recording)
    expect(twilioRecordingSid({ recording_url: `https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/${recording}.mp3` }, account)).toBe(recording)
  })

  it('rejects another account and arbitrary URLs', () => {
    expect(twilioRecordingSid({ recording_url: `https://api.twilio.com/2010-04-01/Accounts/${otherAccount}/Recordings/${recording}.mp3` }, account)).toBeNull()
    expect(twilioRecordingSid({ recording_url: `https://evil.example/2010-04-01/Accounts/${account}/Recordings/${recording}.mp3` }, account)).toBeNull()
    expect(twilioRecordingSid({ recordingUrl: 'javascript:alert(1)' }, account)).toBeNull()
  })
})
