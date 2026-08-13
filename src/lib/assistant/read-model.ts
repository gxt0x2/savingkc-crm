export const ASSISTANT_ACTIVE_STAGES = [
  'new', 'not_contacted', 'contacted', 'qualifying', 'qualified', 'appt_set',
  'appointment_set', 'negotiations', 'offer_made', 'contract_signed', 'under_contract',
]

export function cleanLeadSearch(value: unknown): string {
  return String(value ?? '')
    .replace(/[%_*(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function crmLeadUrl(leadId: string): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/+$/, '')
  return `${origin}/leads/${encodeURIComponent(leadId)}`
}
