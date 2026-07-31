export type ConversationTagCategory = 'Motivation' | 'Seller situation' | 'Property' | 'Risk' | 'Opportunity' | 'Blocker'
export type ConversationTagTone = 'brand' | 'info' | 'success' | 'violet' | 'neutral'

export interface ConversationDecisionTag {
  id: string
  label: string
  category: ConversationTagCategory
  tone: ConversationTagTone
}

export interface ConversationManifestLike {
  flags?: {
    opportunityFlags?: unknown[]
    redFlags?: unknown[]
  }
  situation?: {
    type?: unknown[]
    blockers?: unknown[]
    timeline?: {
      lifeEventType?: unknown
      life_event_type?: unknown
    }
  }
  property?: {
    condition?: { overall?: unknown } | unknown
    occupancy?: unknown
  }
}

interface LeadSignalLike {
  motivation_score?: number | null
}

const DEFINITIONS: Record<string, Omit<ConversationDecisionTag, 'id'>> = {
  inherited: { label: 'Inherited property', category: 'Seller situation', tone: 'info' },
  probate: { label: 'Probate', category: 'Seller situation', tone: 'info' },
  divorce: { label: 'Divorce', category: 'Seller situation', tone: 'info' },
  relocation: { label: 'Relocation', category: 'Seller situation', tone: 'info' },
  financial_distress: { label: 'Financial distress', category: 'Risk', tone: 'brand' },
  tax_delinquent: { label: 'Tax delinquent', category: 'Risk', tone: 'brand' },
  pre_foreclosure: { label: 'Foreclosure risk', category: 'Risk', tone: 'brand' },
  foreclosure: { label: 'Foreclosure risk', category: 'Risk', tone: 'brand' },
  title_issue: { label: 'Title issue', category: 'Blocker', tone: 'brand' },
  liens: { label: 'Liens', category: 'Blocker', tone: 'brand' },
  code_violations: { label: 'Code violations', category: 'Blocker', tone: 'brand' },
  co_ownership: { label: 'Co-owner involved', category: 'Blocker', tone: 'brand' },
  listed_with_agent: { label: 'Listed with agent', category: 'Blocker', tone: 'brand' },
  repairs_needed: { label: 'Needs repairs', category: 'Property', tone: 'neutral' },
  needs_repairs: { label: 'Needs repairs', category: 'Property', tone: 'neutral' },
  vacant: { label: 'Vacant', category: 'Property', tone: 'neutral' },
  tenant_occupied: { label: 'Tenant occupied', category: 'Property', tone: 'neutral' },
  distressed: { label: 'Distressed condition', category: 'Property', tone: 'neutral' },
  poor: { label: 'Poor condition', category: 'Property', tone: 'neutral' },
  high_equity: { label: 'High equity', category: 'Opportunity', tone: 'success' },
  out_of_state_owner: { label: 'Out-of-state owner', category: 'Opportunity', tone: 'success' },
  timeline_pressure: { label: 'Timeline pressure', category: 'Motivation', tone: 'violet' },
  deceased_owner: { label: 'Deceased owner', category: 'Seller situation', tone: 'info' },
}

function id(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function values(input: unknown[] | undefined): string[] {
  return (input ?? []).map(id).filter((value): value is string => Boolean(value))
}

function propertyCondition(manifest: ConversationManifestLike): string | null {
  const condition = manifest.property?.condition
  if (typeof condition === 'string') return id(condition)
  if (condition && typeof condition === 'object' && 'overall' in condition) return id(condition.overall)
  return null
}

/**
 * Only surface durable decision signals. Source, county, stage, assignment,
 * reply state, and transport artifacts (for example ivr_no_input) belong in
 * their own fields and are intentionally not converted into tags.
 */
export function buildConversationDecisionTags(
  manifest: ConversationManifestLike | null | undefined,
  lead: LeadSignalLike = {},
): ConversationDecisionTag[] {
  const safeManifest = manifest ?? {}
  const candidates = [
    ...values(safeManifest.situation?.type),
    ...values(safeManifest.flags?.opportunityFlags),
    ...values(safeManifest.flags?.redFlags),
    id(safeManifest.situation?.timeline?.lifeEventType),
    id(safeManifest.situation?.timeline?.life_event_type),
    propertyCondition(safeManifest),
    id(safeManifest.property?.occupancy),
  ].filter((value): value is string => Boolean(value))

  const tags = new Map<string, ConversationDecisionTag>()
  if ((lead.motivation_score ?? 0) >= 75) {
    tags.set('high_motivation', {
      id: 'high_motivation',
      label: 'High motivation',
      category: 'Motivation',
      tone: 'violet',
    })
  }

  for (const candidate of candidates) {
    const definition = DEFINITIONS[candidate]
    if (!definition) continue
    tags.set(candidate, { id: candidate, ...definition })
  }

  for (const blocker of safeManifest.situation?.blockers ?? []) {
    if (typeof blocker !== 'string') continue
    const clean = blocker.trim().replace(/[_-]+/g, ' ')
    if (!clean || clean.length > 48) continue
    const blockerId = `blocker_${id(clean)}`
    tags.set(blockerId, {
      id: blockerId,
      label: clean.replace(/\b\w/g, (character) => character.toUpperCase()),
      category: 'Blocker',
      tone: 'brand',
    })
  }

  return Array.from(tags.values()).slice(0, 8)
}
