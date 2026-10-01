import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), user: vi.fn(), admin: vi.fn(), reserve: vi.fn(), complete: vi.fn(), updateProperty: vi.fn(),
}))
vi.mock('@/lib/mobile-api/authorized-lead', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/authorized-lead')>(),
  requireAuthorizedMobileLead: mocks.authorize,
}))
vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/mobile-api/command-receipts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/command-receipts')>(),
  reserveMobileCommand: mocks.reserve, completeMobileCommand: mocks.complete,
}))
vi.mock('@/lib/server/mobile-property-details', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/mobile-property-details')>(),
  updateMobilePropertyDetails: mocks.updateProperty,
}))

import { MobileLeadAccessError } from '@/lib/mobile-api/authorized-lead'
import { mobileCommandIdentityUuid } from '@/lib/mobile-api/command-receipts'
import { MobilePropertyError, parseMobilePropertyPatch } from '@/lib/server/mobile-property-details'
import { MobileAttachmentError, safeMobileAttachmentFilename, validateMobileMessageFile } from '@/lib/mobile-api/message-attachments'
import { POST as postNote } from '@/app/api/mobile/v1/leads/[id]/notes/route'
import { POST as postProperty } from '@/app/api/mobile/v1/leads/[id]/property/route'
import { POST as postFavorite } from '@/app/api/mobile/v1/leads/[id]/favorite/route'
import { POST as postPin } from '@/app/api/mobile/v1/conversations/[id]/pin/route'
import { POST as postAttachment } from '@/app/api/mobile/v1/leads/[id]/attachments/route'
import { GET as getAttachment } from '@/app/api/mobile/v1/leads/[id]/attachments/[attachmentId]/route'
import { POST as removeAttachment } from '@/app/api/mobile/v1/leads/[id]/attachments/[attachmentId]/remove/route'
import { POST as postTranscription } from '@/app/api/mobile/v1/leads/[id]/transcriptions/route'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const attachmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const context = { params: Promise.resolve({ id }) }
const attachmentContext = { params: Promise.resolve({ id, attachmentId }) }
const headers = { Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'stable-key-123' }
function request(path: string, method = 'POST', body: unknown = {}) {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/${path}`, {
    method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
}

describe('actor-scoped mobile lead-write routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ actor: { email: 'casey@savingkc.com', fullName: 'Casey' }, lead: { id } })
    mocks.reserve.mockResolvedValue({ kind: 'reserved', token: 'claim-1', plan: null })
    mocks.complete.mockResolvedValue(undefined)
  })

  it.each([
    ['note', postNote, `leads/${id}/notes`, attachmentContext],
    ['property', postProperty, `leads/${id}/property`, attachmentContext],
    ['favorite', postFavorite, `leads/${id}/favorite`, attachmentContext],
    ['conversation pin', postPin, `conversations/${id}/pin`, attachmentContext],
    ['attachment upload', postAttachment, `leads/${id}/attachments`, attachmentContext],
    ['attachment remove', removeAttachment, `leads/${id}/attachments/${attachmentId}/remove`, attachmentContext],
    ['transcription', postTranscription, `leads/${id}/transcriptions`, attachmentContext],
  ])('rejects out-of-scope %s before any command or database mutation', async (_label, handler, path, routeContext) => {
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('Outside authorized scope', 403))
    const response = await handler(request(path), routeContext)
    expect(response.status).toBe(403)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.user).not.toHaveBeenCalled()
  })

  it('rejects out-of-scope attachment URL reads before storage signing', async () => {
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('Outside authorized scope', 403))
    const response = await getAttachment(request(`leads/${id}/attachments/${attachmentId}`, 'GET'), attachmentContext)
    expect(response.status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('inserts a note with the verified actor and completes its receipt', async () => {
    const noteId = '8fc5f683-9780-4d76-a58f-426e83af5894'
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({
      data: { id: noteId, lead_id: id, activity_type: 'note', description: 'Follow up', agent: 'Casey', metadata: { actor_email: 'casey@savingkc.com', idempotency_key: 'stable-key-123' } }, error: null,
    }) }) })
    mocks.admin.mockReturnValue({ from: () => ({ insert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) })
    const response = await postNote(request(`leads/${id}/notes`, 'POST', { description: 'Follow up' }), context)
    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String), lead_id: id, agent: 'Casey', description: 'Follow up' }))
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ token: 'claim-1', status: 201 }))
  })

  it('reconciles an expired note claim from its stable activity without inserting again', async () => {
    mocks.reserve.mockResolvedValue({ kind: 'recovered', token: 'claim-2', plan: null })
    const insert = vi.fn()
    const activity = { id: mobileCommandIdentityUuid('casey@savingkc.com', 'stable-key-123', 'add_note'),
      lead_id: id, activity_type: 'note', description: 'Follow up', agent: 'Casey',
      metadata: { actor_email: 'casey@savingkc.com', idempotency_key: 'stable-key-123' } }
    mocks.admin.mockReturnValue({ from: () => ({ insert,
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: activity, error: null }) }) }),
    }) })
    const response = await postNote(request(`leads/${id}/notes`, 'POST', { description: 'Follow up' }), context)
    expect(response.status).toBe(201)
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ token: 'claim-2', result: { success: true, activity } }))
  })

  it('reports idempotency conflicts without writing the property', async () => {
    mocks.reserve.mockResolvedValue({ kind: 'conflict' })
    const response = await postProperty(request(`leads/${id}/property`, 'POST', {
      bedrooms: 3, bathrooms: 2, sqft: 1200, yearBuilt: 1970, occupancyStatus: 'vacant', expectedUpdatedAt: '2026-10-01T00:00:00Z',
    }), context)
    expect(response.status).toBe(409)
    expect(mocks.updateProperty).not.toHaveBeenCalled()
  })

  it('returns the atomic property conflict receipt without a second completion write', async () => {
    mocks.updateProperty.mockResolvedValue({ status: 409, result: { error: 'Refresh before saving' } })
    const response = await postProperty(request(`leads/${id}/property`, 'POST', {
      bedrooms: 3, bathrooms: 2, sqft: 1200, yearBuilt: 1970, occupancyStatus: 'vacant', expectedUpdatedAt: '2026-10-01T00:00:00Z',
    }), context)
    expect(response.status).toBe(409)
    expect(mocks.updateProperty).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'stable-key-123', leaseToken: 'claim-1' }))
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('uploads an authorized attachment and stores lead-scoped document metadata', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const stableDocumentId = mobileCommandIdentityUuid('casey@savingkc.com', 'stable-key-123', 'upload_message_attachment')
    const stablePath = `lead/${id}/mobile/${stableDocumentId}-house.pdf`
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({
      data: { id: stableDocumentId, entity_type: 'lead', entity_id: id, doc_type: 'message_attachment', filename: 'house.pdf', storage_path: stablePath, mime_type: 'application/pdf', byte_size: 3, uploaded_by: 'casey@savingkc.com', uploaded_at: '2026-10-01T00:00:00Z' }, error: null,
    }) }) })
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    const eq = vi.fn(() => ({ maybeSingle }))
    mocks.admin.mockReturnValue({
      storage: { from: () => ({ upload }) },
      from: () => ({ insert, select: () => ({ eq }) }),
    })
    const form = new FormData()
    form.append('file', new File(['pdf'], 'house.pdf', { type: 'application/pdf' }))
    const response = await postAttachment(new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads/${id}/attachments`, {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Idempotency-Key': 'stable-key-123' }, body: form,
    }), context)
    expect(response.status).toBe(201)
    expect(upload).toHaveBeenCalledWith(expect.stringContaining(id), expect.any(Uint8Array), expect.objectContaining({ contentType: 'application/pdf', upsert: false }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ entity_type: 'lead', entity_id: id, doc_type: 'message_attachment', uploaded_by: 'casey@savingkc.com' }))
    await expect(response.json()).resolves.toMatchObject({ attachment: { id: stableDocumentId, filename: 'house.pdf' } })
  })

  it('reconciles a completed upload without putting another storage object', async () => {
    mocks.reserve.mockResolvedValue({ kind: 'recovered', token: 'claim-2', plan: null })
    const stableDocumentId = mobileCommandIdentityUuid('casey@savingkc.com', 'stable-key-123', 'upload_message_attachment')
    const stablePath = `lead/${id}/mobile/${stableDocumentId}-house.pdf`
    const upload = vi.fn()
    const download = vi.fn(async () => ({ data: new Blob(['pdf']), error: null }))
    const insert = vi.fn()
    mocks.admin.mockReturnValue({
      storage: { from: () => ({ upload, download }) },
      from: () => ({ insert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
        id: stableDocumentId, entity_type: 'lead', entity_id: id, doc_type: 'message_attachment',
        filename: 'house.pdf', storage_path: stablePath, mime_type: 'application/pdf', byte_size: 3,
        uploaded_by: 'casey@savingkc.com', uploaded_at: '2026-10-01T00:00:00Z',
      }, error: null }) }) }) }),
    })
    const form = new FormData()
    form.append('file', new File(['pdf'], 'house.pdf', { type: 'application/pdf' }))
    const response = await postAttachment(new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads/${id}/attachments`, {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Idempotency-Key': 'stable-key-123' }, body: form,
    }), context)
    expect(response.status).toBe(201)
    expect(upload).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledWith(stablePath)
    expect(insert).not.toHaveBeenCalled()
  })

  it('signs only a matching lead attachment after scope authorization', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed' }, error: null })
    mocks.admin.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { id: attachmentId, storage_path: `lead/${id}/house.pdf`, mime_type: 'application/pdf' }, error: null,
      }) }) }) }) }) }) }),
      storage: { from: () => ({ createSignedUrl }) },
    })
    const response = await getAttachment(request(`leads/${id}/attachments/${attachmentId}`, 'GET'), attachmentContext)
    expect(response.status).toBe(200)
    expect(createSignedUrl).toHaveBeenCalledWith(`lead/${id}/house.pdf`, 900)
    await expect(response.json()).resolves.toMatchObject({ mimeType: 'application/pdf', expiresIn: 900 })
  })

  it('pins an authorized conversation in the authenticated user metadata', async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    mocks.user.mockResolvedValue({ user: { id: 'user-1', app_metadata: { pinned_chat_ids: ['other-lead'], theme: 'dark' } } })
    mocks.admin.mockReturnValue({ auth: { admin: { updateUserById } } })
    const response = await postPin(request(`conversations/${id}/pin`, 'POST', { pinned: true }), context)
    expect(response.status).toBe(200)
    expect(updateUserById).toHaveBeenCalledWith('user-1', { app_metadata: {
      pinned_chat_ids: [id, 'other-lead'], theme: 'dark',
    } })
  })
})

describe('lead-write payload validation', () => {
  it('preserves explicit cleared property fields and rejects malformed values', () => {
    expect(parseMobilePropertyPatch({
      bedrooms: null, bathrooms: 0, sqft: null, yearBuilt: null,
      occupancyStatus: null, expectedUpdatedAt: '2026-10-01T00:00:00Z',
    })).toMatchObject({ bedrooms: null, bathrooms: 0, sqft: null, occupancyStatus: null })
    expect(() => parseMobilePropertyPatch({ bedrooms: 2.5, occupancyStatus: 'vacant' })).toThrow(MobilePropertyError)
    expect(() => parseMobilePropertyPatch({ bedrooms: 2, occupancyStatus: 'invented' })).toThrow(MobilePropertyError)
  })

  it('normalizes attachment names and enforces MIME and size limits', () => {
    expect(safeMobileAttachmentFilename('../Résumé of house.pdf', 'application/pdf')).toBe('Resume-of-house.pdf')
    expect(validateMobileMessageFile(new File(['pdf'], 'report.pdf', { type: 'application/pdf' }))).toMatchObject({
      filename: 'report.pdf', mimeType: 'application/pdf',
    })
    expect(() => validateMobileMessageFile(new File(['x'], 'script.html', { type: 'text/html' }))).toThrow(MobileAttachmentError)
    expect(() => validateMobileMessageFile(new File([], 'empty.pdf', { type: 'application/pdf' }))).toThrow(MobileAttachmentError)
  })
})
