import { normalizeMojoDateTime, parseMojoTimestamp, recordingTimestamp, parseMojoRecordingDuration } from '../../scripts/mojo-call-evidence.mjs'

// Admission uses the retained provider facts, not caller-supplied IDs alone.
export function validateMojoSourceCall(call, payload) {
  const ids = call?.provider_activity_ids
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => !/^\d+$/.test(id))) return 'activity_ids_required'
  const activities = ids.map(id => payload.activities.find(row => String(row[0]) === id))
  if (activities.some(row => !row || String(row[4]?.contact_id) !== call.provider_contact_id)) return 'activity_source_mismatch'
  if (!ids.includes(call.provider_action_id)) return 'action_source_mismatch'
  if (call.record_id !== `mojo-activity-${call.provider_contact_id}-${call.provider_action_id}`) return 'record_source_mismatch'
  const action = activities.find(row => String(row[0]) === call.provider_action_id)
  if (call.qualified_by_agent && !activities.some(row => row[1] === 30)) return 'qualification_source_mismatch'
  if (call.has_appointment && !activities.some(row => row[1] === 5)) return 'appointment_source_mismatch'
  if (call.notes && !activities.some(row => row[1] === 3
    && String(row[4]?.contents || '').replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim() === call.notes.trim())) return 'notes_source_mismatch'
  if (call.follow_up_date && !activities.some(row => [5, 6].includes(row[1]) && row[4]?.datetime
    && normalizeMojoDateTime(row[4].datetime) === normalizeMojoDateTime(call.follow_up_date))) return 'followup_source_mismatch'
  if (call.qualification_override_reason) return 'qualification_override_not_source_fact'
  if (call.recording_url || call.provider_recording_id || call.call_duration) {
    const recording = payload.recordings.find(row => String(row.record_id) === call.provider_recording_id)
    if (!recording || String(recording.contact?.id ?? recording.contact_id) !== call.provider_contact_id
      || recording.audio !== call.recording_url) return 'recording_source_mismatch'
    const timestamp = recordingTimestamp(recording)
    if (timestamp == null || timestamp !== Date.parse(call.call_date)
      || parseMojoRecordingDuration(recording.duration_seconds ?? recording.duration) !== call.call_duration
      || Math.abs(timestamp - Date.parse(parseMojoTimestamp(action[3]))) > 90 * 60 * 1000) return 'recording_chronology_mismatch'
  } else if (Date.parse(call.call_date) !== Date.parse(parseMojoTimestamp(action[3]))) return 'activity_chronology_mismatch'
  return null
}

export function mojoLegacyRecordIds(call) {
  return call.provider_activity_ids.map(id => `mojo-activity-${call.provider_contact_id}-${id}`)
}
