import { formatPhone } from '@/lib/format'

export type AppointmentTouch = 'booking_sms' | 'booking_email' | 'confirm_sms' | 'morning_sms' | 'arrival_sms' | 'silence' | 'escalate'

export function appointmentCopy(input: {
  touch: AppointmentTouch; firstName: string; repName: string; repPhone: string
  scheduledAt: string; bookedAt: string; type: string; photoUrl?: string | null
}) {
  const date = new Date(input.scheduledAt)
  const localDay = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(value))
  const sameDay = localDay(input.bookedAt) === localDay(input.scheduledAt)
  const shortNotice = date.getTime() - new Date(input.bookedAt).getTime() < 26 * 60 * 60_000
  const apptDate = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT'
  const name = input.firstName.trim().split(/\s+/)[0] || 'there'
  const rep = input.repName.trim().split(/\s+/)[0]
  const repPhone = formatPhone(input.repPhone)
  const meeting = ['in_person', 'onsite'].includes(input.type) ? 'meeting you' : 'talking with you'
  const bodies: Record<string, string> = {
    booking_sms: `Hey ${name}, it's ${rep} with Saving KC Homebuyers. I have us locked in for ${apptDate} at ${time}. ${shortNotice ? 'Reply YES to confirm. ' : ''}${sameDay ? '' : "I'll text you the morning of too. "}My direct number is ${repPhone} if anything comes up before then.`,
    confirm_sms: `${name}, still good for tomorrow at ${time}? Just reply YES and I'll see you then. If you need to move it, let me know and I'll find another time.`,
    morning_sms: `Good morning ${name}! We're still set for ${time} today. Looking forward to ${meeting}. If anything changes, just text me here.`,
    arrival_sms: `On my way, should be there by ${time}. See you shortly, ${name}.`,
  }
  const text = `Hi ${name},\n\nYou're set for ${apptDate} at ${time}. This'll be about 30 to 60 minutes, no pressure, just walking through your options and getting you real numbers.\n\nI'm ${rep}. My direct number is ${repPhone}, so text or call if something changes.\n\nTalk soon,\n${rep}\nSaving KC Homebuyers`
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
  const photo = input.photoUrl && /^https:\/\//i.test(input.photoUrl)
    ? `<p><img src="${escape(input.photoUrl)}" alt="${escape(rep)}" width="120" style="border-radius:12px" /></p>` : ''
  return { body: bodies[input.touch] || text, subject: `Confirmed: ${apptDate} at ${time}`, html: `<div style="font-family:Arial,sans-serif;max-width:560px">${text.split('\n\n').map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')}${photo}</div>` }
}
