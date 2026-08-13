import { PHONE_SYSTEM } from '@/lib/operating-model/phone-system'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'

export const MAIN_SAVINGKC_CALLER_ID = TWILIO_NUMBERS.find((number) => number.purpose === 'main')?.value ?? '+18163077835'
export const CASEY_CRM_EMAIL = 'casey@savingkc.com'

export interface AgentTelephonyProfile {
  identity: string
  displayName: string
  initials: string
  defaultCallerId: string
  hasDedicatedCallerId: boolean
}

function directAcquisitionsCallerId(owner: string): string | null {
  return PHONE_SYSTEM.find((record) => (
    record.owner.toLowerCase() === owner.toLowerCase()
    && record.team === 'Acquisitions'
    && record.routeType === 'direct_agent'
  ))?.number ?? null
}

const AGENT_PROFILES: Array<{ match: string; profile: AgentTelephonyProfile }> = [
  {
    match: 'ernest',
    profile: {
      identity: 'ernest',
      displayName: 'Ernest',
      initials: 'ED',
      defaultCallerId: directAcquisitionsCallerId('Ernest') ?? MAIN_SAVINGKC_CALLER_ID,
      hasDedicatedCallerId: true,
    },
  },
  {
    match: 'casey',
    profile: {
      identity: 'casey',
      displayName: 'Casey',
      initials: 'CD',
      defaultCallerId: directAcquisitionsCallerId('Casey') ?? MAIN_SAVINGKC_CALLER_ID,
      hasDedicatedCallerId: true,
    },
  },
  {
    match: 'gertha',
    profile: {
      identity: 'gertha',
      displayName: 'Gertha',
      initials: 'GD',
      // No dedicated Gertha DID is recorded in the canonical inventory yet.
      // Keep her on the company main line instead of guessing a personal line.
      defaultCallerId: MAIN_SAVINGKC_CALLER_ID,
      hasDedicatedCallerId: false,
    },
  },
]

export function resolveAgentTelephonyProfile(email: string | null | undefined): AgentTelephonyProfile {
  const normalized = email?.trim().toLowerCase() ?? ''
  const configured = AGENT_PROFILES.find(({ match }) => normalized.includes(match))
  if (configured) return configured.profile

  const localPart = normalized.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  const displayName = localPart
    ? localPart.replace(/\b\w/g, (character) => character.toUpperCase())
    : 'CRM user'
  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'CRM'
  const identity = normalized.replace(/[^a-z0-9_-]/g, '-').slice(0, 80) || 'crm-user'

  return {
    identity,
    displayName,
    initials,
    defaultCallerId: MAIN_SAVINGKC_CALLER_ID,
    hasDedicatedCallerId: false,
  }
}

/**
 * Casey's personal workspace contains her individual scorecard and queue. Use
 * an exact account match here; fuzzy display-name matching is appropriate for
 * caller identity, but it is not an authorization boundary.
 */
export function isCaseyCrmUser(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === CASEY_CRM_EMAIL
}

export function agentNameForCallerId(callerId: string | null | undefined): string | null {
  return AGENT_PROFILES.find(({ profile }) => profile.hasDedicatedCallerId && profile.defaultCallerId === callerId)?.profile.displayName ?? null
}
