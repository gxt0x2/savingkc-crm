const SID_PATTERN = /^RE[0-9a-f]{32}$/i

/** Accept only a Twilio recording in our own account; never fetch a stored arbitrary URL. */
export function twilioRecordingSid(metadata: Record<string, unknown>, accountSid: string | undefined): string | null {
  const direct = metadata.recordingSid
  if (typeof direct === 'string' && SID_PATTERN.test(direct)) return direct
  for (const key of ['recordingUrl', 'recording_url', 'recording'] as const) {
    const value = metadata[key]
    if (typeof value !== 'string' || !value.trim()) continue
    const local = value.trim().match(/^\/api\/recordings\/(RE[0-9a-f]{32})$/i)
    if (local) return local[1]
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.twilio.com'
        || parsed.username || parsed.password || parsed.search || parsed.hash) continue
      const source = parsed.pathname.match(/^\/2010-04-01\/Accounts\/(AC[0-9a-f]{32})\/Recordings\/(RE[0-9a-f]{32})(?:\.mp3)?$/i)
      if (source && accountSid && source[1] === accountSid) return source[2]
    } catch { /* Invalid provider metadata is not a playable source. */ }
  }
  return null
}
