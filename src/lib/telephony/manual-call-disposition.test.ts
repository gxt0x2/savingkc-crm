// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveManualCallDisposition } from './manual-call-disposition'

describe('manual call disposition client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('writes a distinct final disposition event', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    await saveManualCallDisposition({
      phone: '+18165550100',
      disposition: 'no_answer',
      callerId: '+18163077835',
      durationSeconds: 14,
      clientAttemptId: 'attempt-1',
      notes: 'Try tomorrow',
    })

    expect(request).toHaveBeenCalledWith('/api/call-log', expect.objectContaining({
      body: expect.stringContaining('"event":"dispositioned"'),
    }))
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      disposition: 'no_answer',
      clientAttemptId: 'attempt-1',
      notes: 'Try tomorrow',
    })
  })

  it('throws the server error so the wrap-up cannot close on a failed save', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'Outcome store unavailable',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }))

    await expect(saveManualCallDisposition({
      phone: '+18165550100',
      disposition: 'no_answer',
      callerId: null,
      durationSeconds: 0,
      clientAttemptId: null,
    })).rejects.toThrow('Outcome store unavailable')
  })
})
