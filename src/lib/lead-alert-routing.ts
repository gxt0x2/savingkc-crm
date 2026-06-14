export type LeadAlertRecipient = {
  name: 'Ernest' | 'Casey'
  phone: string
  schedule: '24_7' | 'weekday_business_hours'
}

function cleanPhone(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.replace(/\s+/g, '')
}

function chicagoPart(now: Date, type: Intl.DateTimeFormatPartTypes): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)

  return parts.find((part) => part.type === type)?.value ?? ''
}

export function isCaseyLeadAlertWindow(now = new Date()): boolean {
  const weekday = chicagoPart(now, 'weekday')
  const hour = Number(chicagoPart(now, 'hour'))
  if (!Number.isFinite(hour)) return false
  return !['Sat', 'Sun'].includes(weekday) && hour >= 9 && hour < 17
}

export function getLeadAlertRecipients(now = new Date()): LeadAlertRecipient[] {
  const ernestPhone = cleanPhone(process.env.ERNEST_PHONE) || '+18162262552'
  const caseyPhone = cleanPhone(process.env.CASEY_PHONE) || '+18167564943'

  const recipients: LeadAlertRecipient[] = [
    { name: 'Ernest', phone: ernestPhone, schedule: '24_7' },
  ]

  if (isCaseyLeadAlertWindow(now)) {
    recipients.push({ name: 'Casey', phone: caseyPhone, schedule: 'weekday_business_hours' })
  }

  const seen = new Set<string>()
  return recipients.filter((recipient) => {
    if (!recipient.phone || seen.has(recipient.phone)) return false
    seen.add(recipient.phone)
    return true
  })
}
