export function centralSlotDateTime(dateStr: string, slotTime: string): string {
  // Ask the runtime for the real Central offset on this date. Month-based
  // approximations are wrong around the March/November DST boundaries.
  const reference = new Date(`${dateStr}T12:00:00Z`)
  const zoneName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'longOffset',
  }).formatToParts(reference).find((part) => part.type === 'timeZoneName')?.value
  const offset = zoneName?.match(/^GMT([+-]\d{2}:\d{2})$/)?.[1]
  if (!offset) throw new Error('America/Chicago offset unavailable')
  return `${dateStr}T${slotTime}${offset}`
}
