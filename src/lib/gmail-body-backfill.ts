import type { SupabaseClient } from '@supabase/supabase-js'

import { counterpartyLeadIds, type LeadMatchRow } from '@/lib/gmail-sync'

const DAY_MS = 24 * 60 * 60 * 1000
import { fillGmailBodyText, type GmailBodyQuota, type LeadEmailBodyDb } from '@/lib/gmail-message-body'

const PAGE = 200
const PAGE_CAP = 5

type StoredRow = {
  lead_id: string
  gmail_message_id: string | null
  from_address: string | null
  to_addresses: string[] | null
  cc_addresses: string[] | null
}

/**
 * Fill body_text for lead-matched mail already stored in the window.
 * Newsletters and other rows with no counterparty lead are left null.
 */
export async function backfillMatchedGmailBodies(input: {
  db: SupabaseClient
  accessToken: string
  userEmail: string
  leads: LeadMatchRow[]
  internalAddresses: readonly string[]
  since: string
  quota: GmailBodyQuota
  fetchImpl?: typeof fetch
  gapMs?: number
}): Promise<number> {
  const db = input.db as unknown as LeadEmailBodyDb
  let stored = 0
  const seen = new Set<string>()
  for (let page = 0; page < PAGE_CAP && !input.quota.stopped && input.quota.remaining > 0; page += 1) {
    const { data, error } = await input.db
      .from('lead_emails')
      .select('lead_id, gmail_message_id, from_address, to_addresses, cc_addresses, body_text')
      .eq('synced_from_user', input.userEmail)
      .gte('sent_at', input.since)
      .is('body_text', null)
      .order('sent_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) {
      console.error('[gmail-sync] body backfill lookup failed', error)
      return stored
    }
    const rows = (data || []) as StoredRow[]
    if (!rows.length) break
    for (const row of rows) {
      if (!row.gmail_message_id || seen.has(row.gmail_message_id)) continue
      if (input.quota.stopped || input.quota.remaining <= 0) return stored
      const matches = counterpartyLeadIds({
        mailbox: input.userEmail,
        fromAddr: row.from_address || '',
        toAddrs: row.to_addresses || [],
        ccAddrs: row.cc_addresses || [],
        leads: input.leads,
        internalAddresses: input.internalAddresses,
      })
      if (!matches.length) continue
      seen.add(row.gmail_message_id)
      const text = await fillGmailBodyText({
        db,
        accessToken: input.accessToken,
        messageId: row.gmail_message_id,
        leadIds: [...new Set([row.lead_id, ...matches])],
        quota: input.quota,
        fetchImpl: input.fetchImpl,
        gapMs: input.gapMs,
      })
      if (typeof text === 'string') stored += 1
    }
    if (rows.length < PAGE) break
  }
  return stored
}

export async function backfillRecentMatchedGmailBodies(input: {
  db: SupabaseClient
  accessToken: string
  userEmail: string
  leads: LeadMatchRow[]
  internalAddresses: readonly string[]
  daysBack: number
  quota: GmailBodyQuota
}): Promise<number> {
  return backfillMatchedGmailBodies({
    ...input,
    since: new Date(Date.now() - Math.min(input.daysBack, 7) * DAY_MS).toISOString(),
  })
}
