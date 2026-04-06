/**
 * Agent Routing by Twilio Number
 * Determines which agent is primary/secondary for a given inbound number.
 * Casey's numbers (+18167277667, +18163754666) -> Casey first, Ernest second.
 * All other numbers -> Ernest first, Casey second.
 */

const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const CASEY_NUMBERS = ['+18167277667', '+18163754666'] // company + old cell
const CASEY_COMPANY = '+18167277667'
const ERNEST_COMPANY = '+18166088588'

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
 * Casey's numbers -> Casey primary, everything else -> Ernest primary.
 */
export function getAgentRouting(calledNumber: string): AgentRouting {
  if (CASEY_NUMBERS.includes(calledNumber)) {
    return { primary: CASEY, secondary: ERNEST }
  }
  return { primary: ERNEST, secondary: CASEY }
}
