import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'
import { serializeMojoSource } from '@/lib/mojo-source-identity.mjs'
import { validateMojoSourceCall } from '@/lib/mojo-source-proof.mjs'
import { admitMojoCall, loadMojoIntakeSource } from './mojo-intake-admission'
import { mojoSupervisorReceipt } from '../../../scripts/mojo-supervisor-health.mjs'

const payload = { activities: [[81, 6, 'Casey', '09/08/2026 02:22 PM', { contact_id: 7, datetime: '09/14/2026 12:00 PM' }], [88, 3, 'Casey', '09/08/2026 02:25 PM', { contact_id: 7, contents: 'Please call back.' }]], recordings: [] }
const id = createHash('sha256').update(serializeMojoSource(payload)).digest('hex')
const call = { record_id: 'mojo-activity-7-81', provider_action_id: '81', provider_activity_ids: ['81', '88'], provider_contact_id: '7', call_date: '2026-09-08T19:22:00.000Z', call_duration: 0, follow_up_date: '2026-09-14T17:00:00.000Z', disposition: 'Callback Requested', contact_name: '', phone_number: '', property_address: '', city: '', state: '', zip: '', agent_name: '' }
function db(data: unknown, error: unknown = null) {
  const query = { select: () => query, eq: () => query, in: () => Promise.resolve({ data, error }), maybeSingle: () => Promise.resolve({ data, error }) }
  return { from: () => query } as never
}
describe('Mojo source admission and callback continuity', () => {
  it('requires both the running release and an intact archived batch', async () => {
    expect(await loadMojoIntakeSource(db(null), {})).toMatchObject({ status: 409 })
    expect(await loadMojoIntakeSource(db(null), { runtime: expectedRuntime })).toMatchObject({ status: 400 })
    expect(await loadMojoIntakeSource(db(null), { runtime: expectedRuntime, sourceBatchId: id })).toMatchObject({ status: 409 })
    expect(await loadMojoIntakeSource(db({ id, payload }), { runtime: expectedRuntime, sourceBatchId: id })).toMatchObject({ id })
    expect(await loadMojoIntakeSource(db({ id, payload: { ...payload, recordings: [1] } }), { runtime: expectedRuntime, sourceBatchId: id })).toMatchObject({ status: 409 })
  })
  it('preserves the existing record and its task key when a later note previously named the event', async () => {
    const admitted = await admitMojoCall(db([{ record_id: 'mojo-activity-7-88', payload: {} }]), call, { id, payload })
    expect(admitted).toMatchObject({ record_id: 'mojo-activity-7-88', provider_action_id: '81', source_batch_id: id })
    await expect(admitMojoCall(db([{ record_id: 'a', payload: {} }, { record_id: 'b', payload: {} }]), call, { id, payload })).rejects.toThrow('ambiguous_legacy_identity')
  })
  it('rejects a fabricated activity, contact, date, callback or override', () => {
    expect(validateMojoSourceCall(call, payload)).toBeNull()
    for (const change of [{ provider_activity_ids: ['999'] }, { provider_contact_id: '8' }, { call_date: '2026-09-08T21:22:00Z' }, { follow_up_date: '2026-09-15T17:00:00Z' }, { qualification_override_reason: 'override' }]) {
      expect(validateMojoSourceCall({ ...call, ...change }, payload)).not.toBeNull()
    }
  })
  it('requires the recording ID, contact, audio, duration and actual date to agree', () => {
    const recording = { record_id: 123, contact_id: 7, audio: 'https://provider.example/audio/123', duration: 180, call_date: '09/08/2026 02:20 PM' }
    const source = { ...payload, recordings: [recording] }
    const recorded = { ...call, call_date: '2026-09-08T19:20:00Z', recording_url: recording.audio, provider_recording_id: '123', call_duration: 180 }
    expect(validateMojoSourceCall(recorded, source)).toBeNull()
    for (const change of [{ call_duration: 300 }, { call_date: call.call_date }, { provider_recording_id: 'other' }, { recording_url: 'https://wrong.example' }]) {
      expect(validateMojoSourceCall({ ...recorded, ...change }, source)).not.toBeNull()
    }
    expect(validateMojoSourceCall({ ...recorded, call_date: '2026-08-24T19:20:00Z' }, { ...source, recordings: [{ ...recording, call_date: '08/24/2026 02:20 PM' }] })).toBe('recording_chronology_mismatch')
  })
  it('records intake success separately from historical exceptions and operational failure', () => {
    const health = { status: 'attention', runtime: { verified: true }, sessionStatus: 'healthy', syncHealth: 'healthy', businessHours: true, lastSyncAgeMinutes: 1, reconciliation: { counts: { evidencePendingAllAges: 4 } } }
    expect(mojoSupervisorReceipt({ code: 0, timedOut: false }, health)).toMatchObject({ intakeSucceeded: true, status: 'completed_with_review', operationalAttention: false })
    expect(mojoSupervisorReceipt({ code: 0, timedOut: false }, { ...health, lastSyncAgeMinutes: 90 })).toMatchObject({ status: 'attention', operationalAttention: true })
    expect(mojoSupervisorReceipt({ code: 124, timedOut: true }, null)).toMatchObject({ intakeSucceeded: false, status: 'failed', timedOut: true })
  })
})
