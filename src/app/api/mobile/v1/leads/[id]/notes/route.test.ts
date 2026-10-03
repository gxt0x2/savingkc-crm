import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn(), reserve: vi.fn(), complete: vi.fn() }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(), requireAuthorizedMobileLead: mocks.authorize }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/mobile-api/command-receipts', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/command-receipts')>(), reserveMobileCommand: mocks.reserve, completeMobileCommand: mocks.complete }))

import { POST } from './route'
import { GET } from './[noteId]/audio/route'
import { MobileLeadAccessError } from '@/lib/mobile-api/authorized-lead'

const leadId = '11111111-1111-4111-8111-111111111111'
const actor = { email: 'synthetic@savingkc.invalid', fullName: 'Fixture Agent' }
const key = 'fixture-voice-note-key'
const context = { params: Promise.resolve({ id: leadId }) }
function request(file = new File([new Uint8Array([1, 2, 3])], 'voice.m4a', { type: 'audio/mp4' }), duration = '7') {
  const body = new FormData(); body.append('file', file); body.append('description', 'Seller confirmed Thursday.'); body.append('durationSec', duration)
  return new NextRequest(`https://crm.invalid/api/mobile/v1/leads/${leadId}/notes`, { method: 'POST', body, headers: { 'Idempotency-Key': key } })
}

function fixture() {
  const rows = { documents: new Map<string, Record<string, unknown>>(), lead_activities: new Map<string, Record<string, unknown>>() }
  const objects = new Map<string, Blob>()
  const state = { failDocument: false, failActivity: false, publicBucket: false, failSign: false }
  const uploads = vi.fn(async (path: string, bytes: Uint8Array, options: { contentType: string }) => {
    if (objects.has(path)) return { error: { message: 'already exists' } }
    objects.set(path, new Blob([new Uint8Array(bytes)], { type: options.contentType })); return { error: null }
  })
  const downloads = vi.fn(async (path: string) => ({ data: objects.get(path), error: null }))
  const sign = vi.fn(async () => state.failSign ? { data: null, error: { message: 'unavailable' } } : { data: { signedUrl: 'https://private-storage.invalid/signed-audio?expires=300' }, error: null })
  const db = {
    storage: { getBucket: vi.fn(async () => ({ data: { public: state.publicBucket }, error: null })), from: () => ({ upload: uploads, download: downloads, createSignedUrl: sign }) },
    from(table: 'documents' | 'lead_activities') {
      const filters: Array<[string, unknown]> = []
      let insert: Record<string, unknown> | null = null
      const result = async () => {
        if (insert) {
          if ((table === 'documents' && state.failDocument) || (table === 'lead_activities' && state.failActivity)) {
            state.failDocument = false; state.failActivity = false; return { data: null, error: { message: 'injected metadata failure' } }
          }
          if (rows[table].has(String(insert.id))) return { data: null, error: { code: '23505' } }
          // JSONB ordering differs from insertion order; replay must not depend on object key order.
          const stored = JSON.parse(JSON.stringify({ ...insert, created_at: '2026-10-03T00:00:00Z' }))
          if (stored.metadata?.voice_note_audio) stored.metadata.voice_note_audio = Object.fromEntries(Object.entries(stored.metadata.voice_note_audio).reverse())
          rows[table].set(String(insert.id), stored); return { data: stored, error: null }
        }
        return { data: [...rows[table].values()].find((row) => filters.every(([field, value]) => row[field] === value)) ?? null, error: null }
      }
      const chain = { select: () => chain, eq: (field: string, value: unknown) => { filters.push([field, value]); return chain }, maybeSingle: result, single: result,
        insert: (value: Record<string, unknown>) => { insert = value; return chain } }
      return chain
    },
  }
  return { db, rows, objects, state, uploads, downloads, sign }
}

describe('voice notes persist audio and transcript together', () => {
  let fake: ReturnType<typeof fixture>
  beforeEach(() => {
    vi.clearAllMocks(); fake = fixture(); mocks.admin.mockReturnValue(fake.db)
    mocks.authorize.mockResolvedValue({ actor }); mocks.reserve.mockResolvedValue({ kind: 'reserved', token: 'lease' }); mocks.complete.mockResolvedValue(undefined)
  })
  it('saves one audio document and note, then opens only that authorized note with a short-lived URL', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(201)
    const saved = await response.json()
    expect(saved.activity).toMatchObject({ description: 'Seller confirmed Thursday.', agent: 'Fixture Agent', metadata: { actor_email: actor.email, voice_note_audio: { durationSec: 7, mimeType: 'audio/mp4', byteSize: 3 } } })
    expect(fake.rows.documents.size).toBe(1); expect(fake.rows.lead_activities.size).toBe(1); expect(fake.uploads).toHaveBeenCalledOnce()
    const playback = await GET(new NextRequest('https://crm.invalid/audio'), { params: Promise.resolve({ id: leadId, noteId: saved.activity.id }) })
    expect(playback.status).toBe(200); await expect(playback.json()).resolves.toMatchObject({ expiresIn: 300, mimeType: 'audio/mp4' })
    expect(fake.sign).toHaveBeenCalledWith([...fake.objects.keys()][0], 300)
    expect(playback.headers.get('cache-control')).toContain('no-store')
  })
  it.each(['failDocument', 'failActivity'] as const)('recovers an interrupted %s write with the same audio and one note', async (failure) => {
    fake.state[failure] = true
    expect((await POST(request(), context)).status).toBe(503)
    expect(fake.objects.size).toBe(1); expect(fake.rows.lead_activities.size).toBe(0)
    mocks.reserve.mockResolvedValue({ kind: 'recovered', token: 'lease-2' })
    expect((await POST(request(), context)).status).toBe(201)
    expect(fake.objects.size).toBe(1); expect(fake.rows.documents.size).toBe(1); expect(fake.rows.lead_activities.size).toBe(1)
    expect(fake.downloads).toHaveBeenCalled()
  })
  it('reconciles a note saved before receipt completion failed without uploading or inserting again', async () => {
    mocks.complete.mockRejectedValueOnce(new Error('injected receipt failure'))
    const first = await POST(request(), context); expect(first.status).toBe(201)
    expect((await first.json()).warning).toContain('Note saved')
    mocks.reserve.mockResolvedValue({ kind: 'recovered', token: 'lease-2' })
    const second = await POST(request(), context); expect(second.status).toBe(201)
    expect(fake.uploads).toHaveBeenCalledOnce(); expect(fake.rows.lead_activities.size).toBe(1)
  })
  it('rejects a mismatched or pending command before any storage effect', async () => {
    mocks.reserve.mockResolvedValueOnce({ kind: 'conflict' }).mockResolvedValueOnce({ kind: 'pending' })
    expect((await POST(request(), context)).status).toBe(409); expect((await POST(request(), context)).status).toBe(409)
    expect(fake.uploads).not.toHaveBeenCalled()
  })
  it.each([
    [new File([], 'empty.m4a', { type: 'audio/mp4' }), '7', 413],
    [new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.m4a', { type: 'audio/mp4' }), '7', 413],
    [new File(['image'], 'photo.png', { type: 'image/png' }), '7', 415],
    [new File(['audio'], 'voice.m4a', { type: 'audio/mp4' }), '301', 400],
    [new File(['audio'], 'voice.m4a', { type: 'audio/mp4' }), 'NaN', 400],
  ])('rejects invalid audio before upload', async (file, duration, status) => {
    expect((await POST(request(file as File, String(duration)), context)).status).toBe(status)
    expect(fake.uploads).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled()
  })
  it('fails closed if the existing storage bucket is public', async () => {
    fake.state.publicBucket = true
    expect((await POST(request(), context)).status).toBe(503); expect(fake.uploads).not.toHaveBeenCalled()
  })
  it('denies unauthorized writes and playback before storage access', async () => {
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('No access', 403))
    expect((await POST(request(), context)).status).toBe(403)
    expect((await GET(new NextRequest('https://crm.invalid/audio'), { params: Promise.resolve({ id: leadId, noteId: 'other-note' }) })).status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled(); expect(fake.sign).not.toHaveBeenCalled()
  })
  it('cannot sign another lead\'s note or an unattached document', async () => {
    const saved = await (await POST(request(), context)).json()
    const wrongLead = await GET(new NextRequest('https://crm.invalid/audio'), { params: Promise.resolve({ id: 'other-lead', noteId: saved.activity.id }) })
    expect(wrongLead.status).toBe(404)
    fake.rows.documents.clear()
    expect((await GET(new NextRequest('https://crm.invalid/audio'), { params: Promise.resolve({ id: leadId, noteId: saved.activity.id }) })).status).toBe(404)
    expect(fake.sign).not.toHaveBeenCalled()
  })
  it('reports signing failure as retryable rather than a playable asset', async () => {
    const saved = await (await POST(request(), context)).json(); fake.state.failSign = true
    expect((await GET(new NextRequest('https://crm.invalid/audio'), { params: Promise.resolve({ id: leadId, noteId: saved.activity.id }) })).status).toBe(503)
  })
  it('keeps existing text-only note commands working without storage access', async () => {
    const response = await POST(new NextRequest('https://crm.invalid/notes', { method: 'POST', body: JSON.stringify({ description: 'Typed note' }), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key } }), context)
    expect(response.status).toBe(201); expect(fake.db.storage.getBucket).not.toHaveBeenCalled()
    expect((await response.json()).activity.metadata.voice_note_audio).toBeUndefined()
  })
})
