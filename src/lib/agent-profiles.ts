/**
 * Central agent profile mapping used across conversations, activity feeds,
 * and anywhere we need to visually identify who did what.
 */

export interface AgentProfile {
  name: string
  initials: string
  color: string        // Tailwind bg class for avatar
  textColor: string    // Tailwind text class for avatar
  photoUrl?: string    // Optional photo URL (future: from crm_settings)
}

const PROFILES: Record<string, AgentProfile> = {
  Ernest: {
    name: 'Ernest',
    initials: 'ED',
    color: 'bg-slate-800',
    textColor: 'text-white',
  },
  Casey: {
    name: 'Casey',
    initials: 'CK',
    color: 'bg-blue-700',
    textColor: 'text-white',
  },
  System: {
    name: 'System',
    initials: 'SYS',
    color: 'bg-slate-500',
    textColor: 'text-white',
  },
  Ari: {
    name: 'Ari',
    initials: 'Ari',
    color: 'bg-violet-600',
    textColor: 'text-white',
  },
}

/** Look up agent profile by name. Falls back to a generated profile for unknown names. */
export function getAgentProfile(agentName: string | null | undefined): AgentProfile {
  if (!agentName) return PROFILES.System

  // Exact match
  if (PROFILES[agentName]) return PROFILES[agentName]

  // Case-insensitive match
  const lower = agentName.toLowerCase()
  for (const [key, profile] of Object.entries(PROFILES)) {
    if (key.toLowerCase() === lower) return profile
  }

  // Generate initials from name
  const parts = agentName.trim().split(' ')
  const initials = parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase()

  return {
    name: agentName,
    initials,
    color: 'bg-slate-600',
    textColor: 'text-white',
  }
}
