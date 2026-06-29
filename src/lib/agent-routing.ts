import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/**
 * Agent Routing by Twilio Number
 * Determines which agent is primary/secondary for a given inbound number.
 * Casey's numbers (+18167277667, +18163754666) -> Casey first, Ernest second.
 * Ernest's company/dispositions numbers -> Ernest first, Casey second.
 * All other numbers -> Ernest first, Casey second.
 */

const CASEY_PHONE = normalizePhoneToE164(process.env.CASEY_PHONE) || '+18167564943'
const ERNEST_PHONE = normalizePhoneToE164(process.env.ERNEST_PHONE) || '+18162262552'
const CASEY_NUMBERS = ['+18167277667', '+18163754666'] // company + old cell
const CASEY_COMPANY = '+18167277667'
const ERNEST_COMPANY = '+18166088588'
const ERNEST_DISPOSITIONS = '+18166088858'
const ERNEST_NUMBERS = [ERNEST_COMPANY, ERNEST_DISPOSITIONS]

export interface AgentInfo {
  name: string
  phone: string
  email: string
  companyNumber: string
}

export interface AgentRouting {
  primary: AgentInfo
  secondary: AgentInfo
}

const CASEY: AgentInfo = {
  name: 'Casey',
  phone: CASEY_PHONE,
  email: 'casey@savingkc.com',
  companyNumber: CASEY_COMPANY,
}

const ERNEST: AgentInfo = {
  name: 'Ernest',
  phone: ERNEST_PHONE,
  email: 'ernest@savingkc.com',
  companyNumber: ERNEST_COMPANY,
}

/**
 * Get agent routing for a given Twilio number.
 * Casey's numbers -> Casey primary, Ernest's numbers and everything else -> Ernest primary.
 */
export function getAgentRouting(calledNumber: string): AgentRouting {
  if (CASEY_NUMBERS.includes(calledNumber)) {
    return { primary: CASEY, secondary: ERNEST }
  }
  if (ERNEST_NUMBERS.includes(calledNumber)) {
    return { primary: ERNEST, secondary: CASEY }
  }
  return { primary: ERNEST, secondary: CASEY }
}
