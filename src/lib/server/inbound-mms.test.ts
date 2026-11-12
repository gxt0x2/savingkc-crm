import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  captureInboundMms,
  inboundSmsDisplayBody,
  listTwilioMessageMedia,
  readTwilioInboundMedia,
  storeTwilioInboundMedia,
} from './inbound-mms'

const SID = `SM${'a'.repeat(32)}`
const MMS_SID = `MM${'d'.repeat(32)}`
const ACCOUNT_SID = `AC${'b'.repeat(32)}`
const MEDIA_URL = `https://api.twilio.com/2010-04-01/Accounts/AC${'b'.repeat(32)}/Messages/${SID}/Media/ME${'c'.repeat(32)}`

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('inbound MMS capture', () => {
  it('captions a photo-only message and stores bytes without provider URLs', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    const bytes = Uint8Array.from([1, 2, 3, 4])
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(MEDIA_URL)
      expect(init?.redirect).toBe('manual')
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from('ACtest:test-token').toString('base64')}`,
      )
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    })
    const upload = vi.fn(async () => undefined)
    const stored = await storeTwilioInboundMedia({
      messageSid: SID,
      media: [{ index: 0, url: MEDIA_URL, contentType: 'image/jpeg' }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      upload,
    })

    expect(upload).toHaveBeenCalledWith(`${SID}/0-mms-0.jpg`, bytes, 'image/jpeg')
    expect(stored).toEqual([{
      index: 0,
      storage_bucket: 'inbound-mms',
      storage_path: `${SID}/0-mms-0.jpg`,
      content_type: 'image/jpeg',
      byte_size: 4,
    }])
    expect(JSON.stringify(stored)).not.toMatch(/twilio\.com|test-token|http|signed/i)

    const captured = await captureInboundMms({
      form: form({ Body: '   ', NumMedia: '1', MediaUrl0: MEDIA_URL, MediaContentType0: 'image/jpeg' }),
      messageSid: SID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      upload,
    })
    expect(captured.description).toBe('Sent a photo')
    expect(captured.metadata.num_media).toBe(1)
    expect(JSON.stringify(captured.metadata)).not.toMatch(/twilio\.com|MediaUrl|test-token/)
  })

  it('captions several photos and follows only Twilio media redirects', async () => {
    vi.stubEnv('TWILIO_API_KEY', 'SKtest')
    vi.stubEnv('TWILIO_API_SECRET', 'test-secret')
    expect(inboundSmsDisplayBody('', 3)).toBe('Sent 3 photos')
    expect(inboundSmsDisplayBody('See the kitchen', 2)).toBe('See the kitchen')
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === MEDIA_URL) {
        return new Response(null, { status: 302, headers: { location: 'https://media.twiliocdn.com/photo.jpg' } })
      }
      return new Response(Uint8Array.from([9]), { status: 200, headers: { 'content-type': 'image/png' } })
    })
    const upload = vi.fn(async () => undefined)
    const stored = await storeTwilioInboundMedia({
      messageSid: SID,
      media: [{ index: 0, url: MEDIA_URL, contentType: 'image/png' }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      upload,
    })
    expect(stored[0]?.content_type).toBe('image/png')
    expect(stored[0]?.storage_path.startsWith(`${SID}/`)).toBe(true)

    const blocked = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/photo.jpg' },
    }))
    await expect(storeTwilioInboundMedia({
      messageSid: SID,
      media: [{ index: 0, url: MEDIA_URL, contentType: 'image/jpeg' }],
      fetchImpl: blocked as unknown as typeof fetch,
      upload,
    })).rejects.toThrow('left the provider')
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('lists Twilio media for an MM sid and stores it on the same path #802 uses', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT_SID)
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    const mediaSid = `ME${'e'.repeat(32)}`
    const bytes = Uint8Array.from([1, 2, 3, 4])
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/Media.json')) {
        return new Response(JSON.stringify({
          media_list: [{ sid: mediaSid, content_type: 'image/jpeg', uri: 'https://evil.example/steal' }],
        }), { status: 200 })
      }
      expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${MMS_SID}/Media/${mediaSid}`)
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    })
    const media = await listTwilioMessageMedia(MMS_SID, fetchImpl as unknown as typeof fetch)
    const upload = vi.fn(async () => undefined)
    const stored = await storeTwilioInboundMedia({
      messageSid: MMS_SID,
      media,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      upload,
    })
    expect(upload).toHaveBeenCalledWith(`${MMS_SID}/0-mms-0.jpg`, bytes, 'image/jpeg')
    expect(stored[0]?.storage_path).toBe(`${MMS_SID}/0-mms-0.jpg`)
    expect(JSON.stringify(stored)).not.toMatch(/evil\.example|twilio\.com|test-token/)
  })

  it('rejects a missing media URL before any download', () => {
    expect(() => readTwilioInboundMedia(form({ NumMedia: '1' }))).toThrow('Missing Twilio media URL')
    expect(readTwilioInboundMedia(form({ Body: 'hello' }))).toEqual([])
  })
})
