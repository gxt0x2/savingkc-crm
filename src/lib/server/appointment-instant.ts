/** Bare editor dates are Central wall times, never the server machine's zone.
 * Repeated/nonexistent DST wall times require an explicit ISO offset.
 */
export function parseAppointmentInstant(value: string): string | null {
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    // Date.parse rolls impossible calendar dates forward; verify the local
    // components before trusting an otherwise well-formed explicit offset.
    const local = text.replace(/(?:Z|[+-]\d{2}:\d{2})$/i, '')
    const localTimestamp = Date.parse(`${local}Z`)
    const normalizedLocal = local.length === 16 ? `${local}:00` : local.split('.')[0]
    if (!Number.isFinite(localTimestamp)
      || new Date(localTimestamp).toISOString().slice(0, 19) !== normalizedLocal) return null
    const timestamp = Date.parse(text)
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
  }
  const wall = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (!wall) return null
  const normalized = `${wall[1]}T${wall[2]}:${wall[3]}:${wall[4] ?? '00'}`
  const naive = Date.parse(`${normalized}Z`)
  if (!Number.isFinite(naive)) return null
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const matches = [-5, -6].map(offset => naive - offset * 3600000)
    .filter(timestamp => formatter.format(new Date(timestamp)).replace(' ', 'T') === normalized)
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null
}
