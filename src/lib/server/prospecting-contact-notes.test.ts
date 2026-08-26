import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadProspectingContactNotes, saveProspectingContactNote } from '@/lib/server/prospecting-contact-notes'

const actor = { email: 'agent@savingkc.com', name: 'Agent Example' }

function databaseFixture(options: {
  member?: { id: string; subject_kind: 'lead' | 'prospect'; lead_id: string | null; prospect_id: string | null } | null
  prospect?: { id: string; lead_id: string | null } | null
  activities?: Array<Record<string, unknown>>
} = {}) {
  const insert = vi.fn()
  const contains = vi.fn()
  const from = vi.fn((table: string) => {
    if (table === 'prospecting_campaign_members') {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: options.member ?? null, error: null })),
      }
      return builder
    }
    if (table === 'prospects') {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: options.prospect ?? null, error: null })),
      }
      return builder
    }
    if (table === 'lead_activities') {
      const builder = {
        insert: vi.fn((value: unknown) => { insert(value); return builder }),
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        contains: vi.fn((column: string, value: unknown) => { contains(column, value); return builder }),
        order: vi.fn(() => builder),
        limit: vi.fn(async () => ({ data: options.activities ?? [], error: null })),
        single: vi.fn(async () => ({ data: { id: 'activity-1' }, error: null })),
      }
      return builder
    }
    throw new Error(`Unexpected table ${table}`)
  })
  return { database: { from } as unknown as Pick<SupabaseClient, 'from'>, from, insert, contains }
}

describe('saveProspectingContactNote', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists an authenticated note against an unpromoted source Prospect contact', async () => {
    const fixture = databaseFixture({
      member: { id: 'member-1', subject_kind: 'prospect', lead_id: null, prospect_id: 'prospect-1' },
    })

    await saveProspectingContactNote(actor, {
      campaignMemberId: 'member-1',
      prospectId: 'prospect-1',
      dialerSessionId: 'session-1',
      contactKey: 'Lendel Lacy::owner',
      contactName: 'Lendel Lacy',
      relation: 'owner',
      description: '  Sister handles the estate calls.  ',
    }, fixture.database)

    expect(fixture.insert).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: null,
      activity_type: 'note',
      description: 'Sister handles the estate calls.',
      agent: 'Agent Example',
      metadata: expect.objectContaining({
        source: 'prospecting_contact_note',
        is_internal: true,
        subject_kind: 'prospect',
        prospect_id: 'prospect-1',
        campaign_member_id: 'member-1',
        dialer_session_id: 'session-1',
        contact_key: 'Lendel Lacy::owner',
        contact_name: 'Lendel Lacy',
        relationship: 'owner',
      }),
    }))
  })

  it('uses the campaign member as the authoritative subject', async () => {
    const fixture = databaseFixture({
      member: { id: 'member-1', subject_kind: 'lead', lead_id: 'lead-real', prospect_id: null },
    })

    await expect(saveProspectingContactNote(actor, {
      campaignMemberId: 'member-1',
      leadId: 'lead-spoofed',
      contactKey: 'contact-1',
      contactName: 'Contact One',
      description: 'Call after 5 PM.',
    }, fixture.database)).rejects.toMatchObject({
      code: 'contact_note_subject_mismatch',
      status: 409,
    })
    expect(fixture.insert).not.toHaveBeenCalled()
  })

  it('links a promoted source Prospect note to its canonical Lead', async () => {
    const fixture = databaseFixture({ prospect: { id: 'prospect-1', lead_id: 'lead-1' } })

    await saveProspectingContactNote(actor, {
      prospectId: 'prospect-1',
      contactKey: 'contact-1',
      contactName: 'Contact One',
      description: 'Prefers text before a call.',
    }, fixture.database)

    expect(fixture.insert).toHaveBeenCalledWith(expect.objectContaining({ lead_id: 'lead-1' }))
  })

  it('rejects an empty note before database access', async () => {
    const fixture = databaseFixture()

    await expect(saveProspectingContactNote(actor, {
      leadId: 'lead-1',
      contactKey: 'contact-1',
      contactName: 'Contact One',
      description: '   ',
    }, fixture.database)).rejects.toMatchObject({
      code: 'invalid_contact_note',
      status: 400,
    })
    expect(fixture.from).not.toHaveBeenCalled()
  })

  it('loads only bounded contact notes attributed to the requested source Prospect', async () => {
    const activities = [{ id: 'activity-1', activity_type: 'note', description: 'Call the daughter first.' }]
    const fixture = databaseFixture({ activities })

    const result = await loadProspectingContactNotes('prospect-1', fixture.database)

    expect(fixture.contains).toHaveBeenCalledWith('metadata', {
      source: 'prospecting_contact_note',
      prospect_id: 'prospect-1',
    })
    expect(result).toEqual({ activities })
  })

  it('rejects a missing source Prospect before database access', async () => {
    const fixture = databaseFixture()

    await expect(loadProspectingContactNotes(null, fixture.database)).rejects.toMatchObject({
      code: 'invalid_contact_note',
      status: 400,
    })
    expect(fixture.from).not.toHaveBeenCalled()
  })
})
