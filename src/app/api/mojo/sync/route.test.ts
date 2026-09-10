import fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminOrSecret: vi.fn(),
  insert: vi.fn(),
  maybeSingle: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.requireAdminOrSecret }))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: mocks.insert,
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
      update: mocks.update,
    }),
  }),
}))

import { POST } from './route'

const validCall = {
  record_id: 'mojo-1',
  contact_name: 'Seller',
  phone_number: '9135550123',
  property_address: '123 Main',
  city: 'Kansas City',
  state: 'MO',
  zip: '64111',
  call_date: '2026-08-24T12:00:00Z',
  call_duration: 180,
  disposition: 'Callback requested',
  agent_name: 'Casey',
  notes: 'Motivation: retiring. Timeline: 60 days.',
  recording_url: 'https://app71.mojosells.com/audio/1',
  follow_up_date: '2026-08-25T15:00:00Z',
}

describe('/api/mojo/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminOrSecret.mockResolvedValue(null)
    mocks.insert.mockResolvedValue({ error: null })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    mocks.updateEq.mockReturnValue({ eq: mocks.updateEq, select: vi.fn().mockResolvedValue({ data: [{ record_id: 'mojo-1' }], error: null }) })
    mocks.update.mockReturnValue({ eq: mocks.updateEq })
  })

  it('rejects an untrusted request before parsing or writing', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const request = new Request('https://crm.savingkc.com/api/mojo/sync', { method: 'POST', body: '{' })
    const response = await POST(request as never)
    expect(response.status).toBe(401)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('queues normalized provider facts and rejects malformed rows', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: [validCall, { disposition: 'No answer' }] }),
    }) as never)
    await expect(response.json()).resolves.toEqual({
      queued: 1,
      evidenceOnly: 0,
      enriched: 0,
      held: 0,
      heldReasons: {},
      skipped: 0,
      rejected: 1,
      total: 2,
      receipts: [{ recordId: 'mojo-1', status: 'accepted' }, { recordId: null, status: 'rejected', reason: 'invalid_record' }],
    })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'mojo-1', status: 'pending',
    }))
  })

  it('records a callback label without a scheduled time as non-promoted evidence', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: [{
        ...validCall,
        call_duration: 0,
        recording_url: undefined,
        notes: 'Bad time. Asked for a call back later.',
        follow_up_date: undefined,
      }] }),
    }) as never)
    await expect(response.json()).resolves.toMatchObject({
      queued: 1,
      evidenceOnly: 1,
      held: 0,
    })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      payload: expect.objectContaining({
        promotion_eligible: false,
        qualification_status: 'ineligible',
        qualification_reasons: ['callback_without_scheduled_time'],
      }),
    }))
  })

  it('persists a meaningful candidate while its recording evidence is pending', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: [{
        ...validCall,
        disposition: 'Interested',
        call_duration: 0,
        recording_url: undefined,
        follow_up_date: undefined,
      }] }),
    }) as never)
    await expect(response.json()).resolves.toMatchObject({
      queued: 0,
      held: 1,
      heldReasons: { recording_pending: 1 },
    })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'waiting_evidence',
      payload: expect.objectContaining({ qualification_status: 'evidence_pending' }),
    }))
  })

  it('queues a real future follow-up even while qualification evidence is pending', async () => {
    const followUpDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: [{
        ...validCall,
        call_duration: 0,
        recording_url: undefined,
        notes: 'Please call me tomorrow afternoon.',
        follow_up_date: followUpDate,
      }] }),
    }) as never)
    await expect(response.json()).resolves.toMatchObject({
      queued: 1,
      evidenceOnly: 1,
      held: 0,
    })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      payload: expect.objectContaining({
        follow_up_date: followUpDate,
        promotion_eligible: false,
        qualification_status: 'evidence_pending',
      }),
    }))
  })

  it('releases persisted evidence to the worker when a recording arrives later', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } })
    mocks.maybeSingle.mockResolvedValue({
      data: {
        status: 'waiting_evidence',
        payload: {
          ...validCall,
          call_duration: 0,
          recording_url: undefined,
        },
      },
      error: null,
    })

    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: [validCall] }),
    }) as never)

    await expect(response.json()).resolves.toMatchObject({ enriched: 1, held: 0 })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      attempts: 0,
      payload: expect.objectContaining({ promotion_eligible: true, qualification_status: 'eligible' }),
    }))
  })

  it('queues known ineligible evidence without granting promotion authority', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: [{
        ...validCall,
        call_duration: 45,
        notes: 'Bad time. Asked for a call back later.',
        follow_up_date: undefined,
      }] }),
    }) as never)
    await expect(response.json()).resolves.toMatchObject({ queued: 1, evidenceOnly: 1, held: 0 })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ promotion_eligible: false, qualification_status: 'ineligible' }),
    }))
  })

  it.each(['processing', 'read_error', 'update_race'])('does not acknowledge undelivered enrichment during %s', async failure => {
    mocks.insert.mockResolvedValue({ error: { code: '23505' } })
    mocks.maybeSingle.mockResolvedValue({
      data: { status: failure === 'processing' ? 'processing' : 'waiting_evidence', payload: { ...validCall, call_duration: 0, recording_url: undefined } },
      error: failure === 'read_error' ? { message: 'read failed' } : null,
    })
    if (failure === 'update_race') mocks.updateEq.mockReturnValue({ eq: mocks.updateEq, select: vi.fn().mockResolvedValue({ data: [], error: null }) })
    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/sync', { method: 'POST', body: JSON.stringify({ calls: [validCall] }) }) as never)
    expect(await response.json()).toMatchObject({ rejected: 1, receipts: [{ recordId: 'mojo-1', status: 'rejected' }] })
  })

  it('contains no Manifest, scoring, enrichment, alert, or outbound-message work', () => {
    const source = fs.readFileSync('src/app/api/mojo/sync/route.ts', 'utf8')
    expect(source).not.toMatch(/manifest-builder|opportunity_score|classification|safeSendSMS|sendTeamLeadAlert|transcribeAudio|analyzeCallTranscript|enrichManifest/i)
  })
})
