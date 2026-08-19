import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getCurrentUserEmail: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { GET, POST } from './route'

let actorProfile: { role: string; is_admin: boolean } | null
let selectedProfile: Record<string, unknown> | null
let listedProfiles: Array<Record<string, unknown>>

function getRequest(path = '/api/settings') {
  return new NextRequest(`https://crm.savingkc.com${path}`)
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('settings authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actorProfile = { role: 'agent', is_admin: false }
    selectedProfile = {
      email: 'agent@savingkc.com',
      full_name: 'Agent',
      role: 'agent',
      is_admin: false,
    }
    listedProfiles = [selectedProfile]
    mocks.getCurrentUserEmail.mockResolvedValue('agent@savingkc.com')
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('agent_profiles')
      return {
        select: (fields: string) => {
          if (fields === 'role, is_admin') {
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: actorProfile, error: null }),
              }),
            }
          }
          if (fields === 'email, full_name, role, is_admin, profile_photo_url') {
            return {
              order: async () => ({ data: listedProfiles, error: null }),
            }
          }
          return {
            eq: () => ({
              single: async () => ({ data: selectedProfile, error: selectedProfile ? null : { message: 'not found' } }),
            }),
          }
        },
        update: (updates: Record<string, unknown>) => {
          mocks.update(updates)
          return {
            eq: (_field: string, email: string) => ({
              select: async () => ({ data: [{ email, ...updates }], error: null }),
            }),
          }
        },
      }
    })
  })

  it('rejects unauthenticated reads and writes before using service-role data', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)

    const [readResponse, writeResponse] = await Promise.all([
      GET(getRequest()),
      POST(postRequest({ email: 'agent@savingkc.com', full_name: 'Changed' })),
    ])

    expect(readResponse.status).toBe(401)
    expect(writeResponse.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('lets a signed-in user read their own profile', async () => {
    const response = await GET(getRequest('/api/settings?email=agent%40savingkc.com'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      profile: { email: 'agent@savingkc.com', is_admin: false },
    })
  })

  it('does not fuzzy-match another profile when the exact email is absent', async () => {
    selectedProfile = null

    const response = await GET(getRequest('/api/settings?email=agent%40savingkc.com'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ profile: null })
    expect(mocks.from).toHaveBeenCalledTimes(2)
  })

  it('blocks a regular user from listing or reading other profiles', async () => {
    const [listResponse, otherResponse] = await Promise.all([
      GET(getRequest('/api/settings?all=true')),
      GET(getRequest('/api/settings?email=owner%40savingkc.com')),
    ])

    expect(listResponse.status).toBe(403)
    expect(otherResponse.status).toBe(403)
  })

  it('allows only explicitly self-editable fields', async () => {
    const response = await POST(postRequest({
      email: 'agent@savingkc.com',
      full_name: 'Updated Agent',
      notification_prefs: { sms: true },
    }))

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      full_name: 'Updated Agent',
      notification_prefs: { sms: true },
    })
  })

  it('blocks a regular user from changing their assigned Twilio number', async () => {
    const response = await POST(postRequest({
      email: 'agent@savingkc.com',
      assigned_twilio_number: '+18166088559',
    }))

    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('blocks a regular user from editing another profile', async () => {
    const response = await POST(postRequest({
      email: 'owner@savingkc.com',
      full_name: 'Changed by another user',
    }))

    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects attempts to change role or admin status', async () => {
    const response = await POST(postRequest({
      email: 'agent@savingkc.com',
      role: 'owner',
      is_admin: true,
    }))

    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('role'),
    })
  })

  it('lets an owner list profiles and edit another agent without exposing admin fields', async () => {
    actorProfile = { role: 'owner', is_admin: false }
    listedProfiles = [
      { email: 'owner@savingkc.com', full_name: 'Owner', role: 'owner', is_admin: false },
      { email: 'agent@savingkc.com', full_name: 'Agent', role: 'agent', is_admin: false },
    ]
    mocks.getCurrentUserEmail.mockResolvedValue('owner@savingkc.com')

    const listResponse = await GET(getRequest('/api/settings?all=true'))
    const updateResponse = await POST(postRequest({
      email: 'agent@savingkc.com',
      office_hours: { enabled: true, start: '08:00', end: '17:00' },
    }))

    expect(listResponse.status).toBe(200)
    expect(updateResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({ profiles: listedProfiles })
  })

  it.each([
    ['owner', { role: 'owner', is_admin: false }, 'owner@savingkc.com'],
    ['admin', { role: 'agent', is_admin: true }, 'admin@savingkc.com'],
  ])('lets an %s assign a normalized approved outbound number', async (_label, managingProfile, managingEmail) => {
    actorProfile = managingProfile
    mocks.getCurrentUserEmail.mockResolvedValue(managingEmail)

    const response = await POST(postRequest({
      email: 'agent@savingkc.com',
      assigned_twilio_number: '(816) 608-8559',
    }))

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      assigned_twilio_number: '+18166088559',
    })
  })

  it.each([
    ['an unknown number', '+18165550123'],
    ['a reserved Google Ads number', '+18166088808'],
  ])('rejects %s as an assigned Twilio number', async (_label, assignedTwilioNumber) => {
    actorProfile = { role: 'owner', is_admin: false }
    mocks.getCurrentUserEmail.mockResolvedValue('owner@savingkc.com')

    const response = await POST(postRequest({
      email: 'agent@savingkc.com',
      assigned_twilio_number: assignedTwilioNumber,
    }))

    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
