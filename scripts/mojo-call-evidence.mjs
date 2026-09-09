const CENTRAL_TIME_ZONE = 'America/Chicago'
const RECORDING_MATCH_WINDOW_MS = 90 * 60 * 1000

export function centralDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CENTRAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function centralWallClockUtc(year, month, day, hours, minutes, seconds = 0) {
  const desiredWallClock = Date.UTC(year, month - 1, day, hours, minutes, seconds)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  })
  let instant = desiredWallClock
  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    const representedWallClock = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    )
    instant = desiredWallClock - (representedWallClock - instant)
  }
  return new Date(instant)
}

export function parseMojoTimestamp(value) {
  const match = String(value || '').trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(AM|PM)$/i,
  )
  if (!match) throw new Error(`Invalid Mojo timestamp: ${String(value || '')}`)
  const [, month, day, year, rawHours, minutes, seconds = '0', ampm] = match
  let hours = Number(rawHours) % 12
  if (ampm.toUpperCase() === 'PM') hours += 12
  return centralWallClockUtc(
    Number(year), Number(month), Number(day), hours, Number(minutes), Number(seconds),
  ).toISOString()
}

export function centralMidnightIso(dateString) {
  const match = String(dateString || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error(`Invalid Central date: ${String(dateString || '')}`)
  return centralWallClockUtc(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0).toISOString()
}

export function normalizeMojoDateTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) return parseMojoTimestamp(raw)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return centralMidnightIso(raw)
  const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (local) {
    return centralWallClockUtc(
      Number(local[1]), Number(local[2]), Number(local[3]),
      Number(local[4]), Number(local[5]), Number(local[6] || 0),
    ).toISOString()
  }
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Mojo date/time: ${raw}`)
  return new Date(parsed).toISOString()
}

export function parseMojoRecordingDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value))
  const parts = String(value || '0').split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0
  if (parts.length === 3) return Math.trunc(parts[0] * 3600 + parts[1] * 60 + parts[2])
  if (parts.length === 2) return Math.trunc(parts[0] * 60 + parts[1])
  return Math.max(0, Math.trunc(parts[0] || 0))
}

function recordingTimestamp(recording) {
  const candidates = [
    recording?.call_at,
    recording?.call_date,
    recording?.datetime,
    recording?.recording_date,
    recording?.created_at,
    recording?.create_date,
    recording?.date,
    recording?.start_time,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(String(candidate))) {
        return Date.parse(parseMojoTimestamp(candidate))
      }
      const parsed = Date.parse(String(candidate))
      if (Number.isFinite(parsed)) return parsed
    } catch {
      // Try the next provider field.
    }
  }
  return null
}

export function indexMojoRecordings(recordings) {
  const byContact = new Map()
  for (const recording of Array.isArray(recordings) ? recordings : []) {
    const contactId = recording?.contact?.id ?? recording?.contact_id
    if (contactId == null || !recording?.audio) continue
    const key = String(contactId)
    const indexed = {
      audio: String(recording.audio),
      duration: parseMojoRecordingDuration(recording.duration_seconds ?? recording.duration),
      recordId: recording.record_id == null ? '' : String(recording.record_id),
      timestamp: recordingTimestamp(recording),
      consumed: false,
    }
    const current = byContact.get(key) || []
    current.push(indexed)
    byContact.set(key, current)
  }
  return byContact
}

export function matchMojoRecording(recordingIndex, contactId, callAt) {
  const candidates = (recordingIndex?.get(String(contactId)) || []).filter((recording) => !recording.consumed)
  if (candidates.length === 0) return null
  const callTime = Date.parse(String(callAt || ''))
  const timed = Number.isFinite(callTime)
    ? candidates
      .filter((recording) => recording.timestamp != null)
      .map((recording) => ({ recording, distance: Math.abs(recording.timestamp - callTime) }))
      .filter(({ distance }) => distance <= RECORDING_MATCH_WINDOW_MS)
      .sort((left, right) => left.distance - right.distance || right.recording.duration - left.recording.duration)
    : []
  const match = timed[0]?.recording
    || (candidates.length === 1 ? candidates[0] : null)
  if (!match) return null
  match.consumed = true
  return {
    audio: match.audio,
    duration: match.duration,
    recordId: match.recordId,
  }
}
