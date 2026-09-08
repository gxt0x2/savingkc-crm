function mojoTimestampMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
  if (!match) return null
  const [, month, day, year, rawHour, minute, meridiem] = match
  let hour = Number(rawHour)
  if (meridiem.toUpperCase() === 'PM' && hour !== 12) hour += 12
  if (meridiem.toUpperCase() === 'AM' && hour === 12) hour = 0
  return Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute)) / 60_000
}

export function mojoReportDate(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!match) return null
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

export function recordingDurationSeconds(value) {
  const parts = String(value || '').split(':').map(Number)
  if (parts.some(part => !Number.isFinite(part))) return 0
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2])
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1])
  return Math.max(0, parts[0] || 0)
}

export function buildRecordingCandidateMap(recordings, targetDate) {
  const map = new Map()
  let accepted = 0
  for (const record of Array.isArray(recordings) ? recordings : []) {
    if (mojoReportDate(record?.date) !== targetDate) continue
    const contactId = Number(record?.contact?.id)
    if (!Number.isFinite(contactId) || !record?.audio || !record?.record_id) continue
    const candidates = map.get(contactId) || []
    candidates.push({
      audio: record.audio,
      duration: recordingDurationSeconds(record.duration),
      recordId: String(record.record_id),
      date: record.date,
      agentName: record.agent_name || '',
      result: record.result || '',
    })
    map.set(contactId, candidates)
    accepted++
  }
  return { map, accepted }
}

export function selectRecordingCandidate(recordingMap, contactId, activityTimestamp, maxDistanceMinutes = 120) {
  const candidates = recordingMap?.get(Number(contactId)) || []
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const activityMinutes = mojoTimestampMinutes(activityTimestamp)
  if (activityMinutes == null) return null
  const ranked = candidates
    .map(candidate => ({ candidate, distance: Math.abs((mojoTimestampMinutes(candidate.date) ?? Number.POSITIVE_INFINITY) - activityMinutes) }))
    .sort((left, right) => left.distance - right.distance)

  if (!Number.isFinite(ranked[0]?.distance) || ranked[0].distance > maxDistanceMinutes) return null
  if (ranked[1] && ranked[0].distance === ranked[1].distance) return null
  return ranked[0].candidate
}
