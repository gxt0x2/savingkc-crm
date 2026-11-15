import { describe, expect, it, vi } from 'vitest'
import { playableRecordingUrl } from './call-recordings'
import {
  openPlayback,
  playbackFallbackOrder,
  publicRecordingObjectPath,
  signedRecordingRoute,
  twilioStoragePath,
} from './recording-playback'

const publicUrls = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
].map((id) => `https://project.supabase.co/storage/v1/object/public/recordings/leads/${id}/call.mp3`)

describe('recording playback order', () => {
  it('tries the stored file before the live provider', async () => {
    expect(playbackFallbackOrder({ storagePath: 'leads/lead/call.mp3', providerAvailable: true })).toEqual(['stored', 'provider'])
    expect(playbackFallbackOrder({ storagePath: null, providerAvailable: true })).toEqual(['provider'])
    expect(playbackFallbackOrder({ storagePath: 'leads/lead/call.mp3', providerAvailable: false })).toEqual(['stored'])

    const storedFirst = vi.fn(async () => true)
    const provider = vi.fn(async () => true)
    await expect(openPlayback({
      storagePath: 'leads/lead/call.mp3',
      providerAvailable: true,
      openStored: storedFirst,
      openProvider: provider,
    })).resolves.toBe('stored')
    expect(provider).not.toHaveBeenCalled()

    const storedMiss = vi.fn(async () => false)
    const providerHit = vi.fn(async () => true)
    await expect(openPlayback({
      storagePath: 'attempts/attempt/call.mp3',
      providerAvailable: true,
      openStored: storedMiss,
      openProvider: providerHit,
    })).resolves.toBe('provider')
    expect(storedMiss).toHaveBeenCalledTimes(1)
    expect(providerHit).toHaveBeenCalledTimes(1)
  })

  it('sends the five public-form recording urls through the signed route', () => {
    expect(publicUrls).toHaveLength(5)
    for (const url of publicUrls) {
      const path = publicRecordingObjectPath(url)
      expect(path).toMatch(/^leads\/[0-9a-f-]+\/call\.mp3$/)
      expect(playableRecordingUrl({ recordingUrl: url })).toBe(signedRecordingRoute(path || ''))
      expect(playableRecordingUrl({ recordingUrl: url })).not.toContain('/object/public/')
    }
  })

  it('keeps a provider fallback url when a recording sid is known', () => {
    const sid = 'REaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    expect(playableRecordingUrl({
      recordingSid: sid,
      recordingUrl: publicUrls[0],
    })).toBe(`/api/recordings/${sid}`)
  })

  it('builds the twilio storage path from the lead or the attempt', () => {
    const sid = 'RE0123456789abcdef0123456789abcdef'
    const leadId = '99999999-9999-4999-8999-999999999999'
    const attemptId = '88888888-8888-4888-8888-888888888888'
    expect(twilioStoragePath({ leadId, attemptId, recordingSid: sid })).toBe(`leads/${leadId}/twilio_${sid}.mp3`)
    expect(twilioStoragePath({ leadId: null, attemptId, recordingSid: sid })).toBe(`attempts/${attemptId}/twilio_${sid}.mp3`)
  })
})
