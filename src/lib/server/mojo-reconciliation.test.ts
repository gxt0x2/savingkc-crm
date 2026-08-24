import { describe, expect, it } from 'vitest'
import { reconcileMojoCalls } from './mojo-reconciliation'

const baseCall = {
  record_id: 'record-1', contact_name: 'Seller', phone_number: '816-555-0123',
  property_address: 'Mojo address', city: 'Kansas City', state: 'MO', zip: '64101',
  call_date: '2026-08-24T15:00:00.000Z', call_duration: 120,
  disposition: 'Callback Requested', agent_name: 'Casey', email: 'seller@example.com',
  list_name: 'County list', campaign_name: 'August',
}

const lead = {
  id: 'lead-1', full_name: 'Unknown', phone: '+18165550123', email: null,
  property_address: 'Canonical address', city: 'Independence', state: 'MO', zip: '64050',
  source: 'jackson_county', mojo_record_id: null, call_result: null, call_duration_seconds: null,
  station: 'new', assigned_agent: null,
}

describe('Mojo dry-run reconciliation', () => {
  it('reports approved diffs while blocking property and source changes', () => {
    const result = reconcileMojoCalls({ calls: [baseCall], leads: [lead], prospectPhones: [], existingEvents: [] })
    expect(result.summary).toMatchObject({
      sourceRows: 1,
      newProviderEvents: 1,
      matched: 1,
      leadPatches: 1,
      protectedWrites: 0,
      eligibleOutcomeCounts: { callback_scheduled: 1 },
      governedCommandCandidates: { assignment: 1, lifecycle_transition: 1 },
    })
    expect(result.summary.leadPatchFields).toMatchObject({ full_name: 1, email: 1, mojo_record_id: 1, call_result: 1 })
    expect(result.summary.blockedCanonicalDiffs).toEqual({ property_address: 1, city: 1, zip: 1, source: 1 })
    expect(result.eligibleRecordIds).toEqual(['record-1'])
  })

  it('separates replayed, ambiguous, invalid, and identity-shell rows', () => {
    const result = reconcileMojoCalls({
      calls: [
        baseCall,
        { ...baseCall, record_id: 'record-2', phone_number: '913-555-0100' },
        { ...baseCall, record_id: 'record-3', phone_number: '' },
        { ...baseCall, record_id: 'record-4', phone_number: '816-555-0999' },
      ],
      leads: [lead, { ...lead, id: 'lead-2' }],
      prospectPhones: [{ phone: '816-555-0123', leadId: 'lead-2' }],
      existingEvents: [{ recordId: 'record-2', leadId: null, callAt: baseCall.call_date }],
    })
    expect(result.summary).toMatchObject({ alreadyPresent: 1, ambiguous: 1, invalidPhone: 1, wouldCreateIdentityShell: 1 })
  })
})
