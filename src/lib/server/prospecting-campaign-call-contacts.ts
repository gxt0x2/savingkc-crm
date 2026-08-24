export interface CampaignCallContactSnapshot {
  id: string
  source_kind: 'lead_primary' | 'prospect_phone'
  prospect_id: string | null
  prospect_phone_id: string | null
  phone_snapshot: string
  contact_name: string | null
  relationship: string | null
  phone_type: string | null
  status: 'ready' | 'suppressed' | 'removed'
  suppression_reason: string | null
  enrolled_at: string
}

export interface CampaignCallContactHistory {
  attempted: boolean | null
  last_disposition: string | null
  last_attempt_at: string | null
  is_verified_contact?: boolean | null
  verified_at?: string | null
  verified_by?: string | null
}

export function buildCampaignCallContactGroups(
  contacts: CampaignCallContactSnapshot[],
  historyByPhone: ReadonlyMap<string, CampaignCallContactHistory>,
) {
  const groups = new Map<string, {
    key: string
    contact_name: string
    relationship: string
    address: null
    phones: Array<{
      id: string
      snapshot_id: string
      prospect_id: string | null
      prospect_phone_id: string | null
      number: string
      type: string | null
      connected: null
      status: 'ready' | 'suppressed'
      suppression_reason: string | null
      attempted: boolean
      last_disposition: string | null
      last_attempt_at: string | null
      is_verified_contact: boolean
      verified_at: string | null
      verified_by: string | null
    }>
  }>()

  for (const [index, contact] of contacts.entries()) {
    if (contact.status === 'removed') continue
    const name = contact.contact_name?.trim() || `Unknown ${index + 1}`
    const relationship = contact.relationship?.trim() || 'associated person'
    const key = `${name}::${relationship}`
    const history = contact.prospect_phone_id ? historyByPhone.get(contact.prospect_phone_id) : null
    const sourcePhoneMissing = contact.source_kind === 'prospect_phone' && !contact.prospect_phone_id
    const phone = {
      id: contact.id,
      snapshot_id: contact.id,
      prospect_id: contact.prospect_id,
      prospect_phone_id: contact.prospect_phone_id,
      number: contact.phone_snapshot,
      type: contact.phone_type,
      connected: null,
      status: sourcePhoneMissing ? 'suppressed' as const : contact.status === 'suppressed' ? 'suppressed' as const : 'ready' as const,
      suppression_reason: sourcePhoneMissing ? 'source_phone_removed' : contact.suppression_reason,
      attempted: history?.attempted ?? false,
      last_disposition: history?.last_disposition ?? null,
      last_attempt_at: history?.last_attempt_at ?? null,
      is_verified_contact: history?.is_verified_contact ?? false,
      verified_at: history?.verified_at ?? null,
      verified_by: history?.verified_by ?? null,
    }
    const existing = groups.get(key)
    if (existing) existing.phones.push(phone)
    else groups.set(key, { key, contact_name: name, relationship, address: null, phones: [phone] })
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    unattempted_count: group.phones.filter((phone) => phone.status === 'ready' && !phone.attempted).length,
  })).sort((a, b) => b.unattempted_count - a.unattempted_count || a.contact_name.localeCompare(b.contact_name))
}
