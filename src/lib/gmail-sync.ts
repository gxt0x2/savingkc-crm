import type { SupabaseClient } from '@supabase/supabase-js'
import { afterRequest } from '@/lib/after-request'
import { notifyInboundEmail } from '@/lib/inbound-email-alert'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { markOAuthConnected, persistOAuthHealth, readOAuthHealth } from '@/lib/oauth-health'
import { isUniqueViolation, stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'

export interface StoredToken {
  id: string
  user_email: string
  access_token: string | null
  refresh_token: string
  expires_at: string | null
  last_sync_at: string | null
}

export type GoogleAccessTokenResult = {
  accessToken: string | null
  error: 'google_oauth_not_configured' | 'token_refresh_failed' | 'reauthorization_required' | null
}

interface GmailMessage {
  id: string
  threadId: string
  historyId?: string
  internalDate?: string
  payload?: {
    headers?: { name: string; value: string }[]
  }
  snippet?: string
}

export function hasGoogleOAuthConfig(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  )
}

// ---------------------------------------------------------------------------
// Refresh an access token if it's expired and persist actionable connection
// health so cron jobs stop retrying a revoked grant every few minutes.
// ---------------------------------------------------------------------------
export async function getValidAccessTokenResult(token: StoredToken): Promise<GoogleAccessTokenResult> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('[gmail-sync] Google OAuth env is not configured.')
    return { accessToken: null, error: 'google_oauth_not_configured' }
  }

  const db = supabaseAdmin()
  const health = await readOAuthHealth(db, 'google', token.user_email)
  if (health?.status === 'reauthorization_required') {
    return { accessToken: null, error: 'reauthorization_required' }
  }

  const expiresAt = token.expires_at ? new Date(token.expires_at).getTime() : 0
  const buffer = 60_000 // 1 min

  if (token.access_token && expiresAt > Date.now() + buffer) {
    return { accessToken: token.access_token, error: null }
  }

  // Refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; error_description?: string }
    const errorCode = body.error || `oauth_http_${res.status}`
    const errorMessage = body.error_description || 'Google token refresh failed'
    const reauthorizationRequired = errorCode === 'invalid_grant'
    await persistOAuthHealth(db, {
      provider: 'google',
      userEmail: token.user_email,
      status: reauthorizationRequired ? 'reauthorization_required' : 'error',
      errorCode,
      errorMessage,
    })
    console.warn(`[gmail-sync] OAuth refresh ${reauthorizationRequired ? 'requires reconnection' : 'failed'} for ${token.user_email}: ${errorCode}`)
    return {
      accessToken: null,
      error: reauthorizationRequired ? 'reauthorization_required' : 'token_refresh_failed',
    }
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  await db.from('user_oauth_tokens').update({
    access_token: data.access_token,
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', token.id)

  await markOAuthConnected(db, 'google', token.user_email)

  return { accessToken: data.access_token, error: null }
}

export async function getValidAccessToken(token: StoredToken): Promise<string | null> {
  return (await getValidAccessTokenResult(token)).accessToken
}

// ---------------------------------------------------------------------------
// Match an email address to a lead by email, name, or property address.
// Returns the lead_id if found.
// ---------------------------------------------------------------------------
export interface LeadMatchRow {
  id: string
  email: string | null
  full_name: string | null
  property_address: string | null
}

export function matchLeadToMessage(
  fromAddr: string,
  toAddrs: string[],
  subject: string,
  snippet: string,
  leads: LeadMatchRow[]
): string | null {
  const allAddrs = [fromAddr, ...toAddrs].map(s => s.toLowerCase())
  const haystack = `${subject} ${snippet}`.toLowerCase()

  // 1) Exact email match (highest priority)
  for (const lead of leads) {
    if (lead.email && allAddrs.includes(lead.email.toLowerCase())) {
      return lead.id
    }
  }

  // 2) Full name in subject/snippet
  for (const lead of leads) {
    if (lead.full_name && lead.full_name.length > 4) {
      const parts = lead.full_name.toLowerCase().split(/\s+/)
      // Require both first and last name to appear to avoid false positives
      if (parts.length >= 2 && parts.every(p => p.length > 2 && haystack.includes(p))) {
        return lead.id
      }
    }
  }

  // 3) Property address in subject/snippet (street number + street name)
  for (const lead of leads) {
    if (lead.property_address && lead.property_address.length > 5) {
      const addr = lead.property_address.toLowerCase()
      // Match first 2 tokens (number + street name root)
      const tokens = addr.split(/\s+/).filter(t => t.length > 1).slice(0, 2)
      if (tokens.length === 2 && tokens.every(t => haystack.includes(t))) {
        return lead.id
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Extract header value from Gmail message
// ---------------------------------------------------------------------------
function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function parseAddrList(s: string): string[] {
  if (!s) return []
  return s.split(',').map(addr => {
    const match = addr.match(/<([^>]+)>/) || [null, addr.trim()]
    return (match[1] || '').toLowerCase().trim()
  }).filter(Boolean)
}

export type GmailMessageStub = { id: string; threadId: string }

const COMPANY_MAIL_DOMAIN = '@savingkc.com'
const STORED_BACKFILL_LIMIT = 500
const DAY_MS = 24 * 60 * 60 * 1000

function normalizedAddress(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

function internalAddressSet(mailbox: string, internalAddresses: readonly string[] | undefined): Set<string> {
  return new Set([mailbox, ...(internalAddresses ?? [])].map(normalizedAddress).filter(Boolean))
}

function isInternalAddress(address: string, internal: ReadonlySet<string>): boolean {
  return internal.has(address) || address.endsWith(COMPANY_MAIL_DOMAIN)
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function entityCodePoint(codePoint: number, entity: string): string {
  const valid = Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)
  return valid ? String.fromCodePoint(codePoint) : entity
}

// Gmail returns message snippets HTML-escaped ("I&#39;m in"). One pass, so
// "&amp;lt;" stays the literal text "&lt;".
export function decodeGmailSnippet(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase()
    if (lower.startsWith('#x')) return entityCodePoint(Number.parseInt(lower.slice(2), 16), entity)
    if (lower.startsWith('#')) return entityCodePoint(Number.parseInt(lower.slice(1), 10), entity)
    return NAMED_ENTITIES[lower] ?? entity
  })
}

// CRM users who connected Google. A lead row that carries one of these
// addresses (a self-test lead) would otherwise match every message in that
// user's own mailbox.
export async function loadGmailInternalAddresses(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from('user_oauth_tokens')
    .select('user_email, crm_user_email')
    .eq('provider', 'google')
  if (error) throw new Error(`gmail_internal_addresses_unavailable: ${error.message}`)
  const rows = (data || []) as Array<{ user_email: string | null; crm_user_email: string | null }>
  return [...new Set(rows.map((row) => normalizedAddress(row.crm_user_email || row.user_email)).filter(Boolean))]
}

// The leads on the other side of the conversation: the sender of mail into
// this mailbox, or the recipients of mail this mailbox sent. The mailbox and
// CRM users never count, so newsletters and internal mail have no lead here.
export function counterpartyLeadIds(input: {
  mailbox: string
  fromAddr: string
  toAddrs: string[]
  ccAddrs?: string[]
  leads: LeadMatchRow[]
  internalAddresses: readonly string[]
}): string[] {
  const mailbox = normalizedAddress(input.mailbox)
  const fromAddr = normalizedAddress(input.fromAddr)
  const internal = internalAddressSet(mailbox, input.internalAddresses)
  const sides = fromAddr === mailbox ? [...input.toAddrs, ...(input.ccAddrs ?? [])] : [fromAddr]
  const counterparties = new Set(sides.map(normalizedAddress).filter((addr) => addr && !isInternalAddress(addr, internal)))
  if (!counterparties.size) return []
  return input.leads.filter((lead) => counterparties.has(normalizedAddress(lead.email))).map((lead) => lead.id)
}

// Two directions land on the lead. A reply is mail the lead wrote into this
// mailbox. A send is mail this mailbox wrote to the lead's address, including
// a message composed in Gmail rather than the app. Newsletters addressed to
// the lead stay in lead_emails. The lead's own mailbox is not treated as the
// company sending that mail, and a lead carrying a CRM user's address is
// never projected.
export function leadThreadActivity(input: {
  leadId: string
  leadEmail: string | null | undefined
  mailbox: string
  fromAddr: string
  toAddrs: string[]
  ccAddrs?: string[]
  subject: string
  snippet: string
  sentAt: string
  gmailMessageId: string
  gmailThreadId: string
  internalAddresses?: readonly string[]
}): {
  lead_id: string
  activity_type: 'email' | 'email_received'
  description: string
  agent: string | null
  created_at: string
  metadata: Record<string, unknown>
} | null {
  const leadEmail = input.leadEmail?.trim().toLowerCase() || ''
  const fromAddr = input.fromAddr.trim().toLowerCase()
  const mailbox = input.mailbox.trim().toLowerCase()
  const recipients = [...input.toAddrs, ...(input.ccAddrs ?? [])].map((addr) => addr.trim().toLowerCase()).filter(Boolean)
  if (!leadEmail || !fromAddr) return null
  if (isInternalAddress(leadEmail, internalAddressSet(mailbox, input.internalAddresses))) return null
  const inbound = fromAddr === leadEmail && fromAddr !== mailbox
  const outbound = fromAddr === mailbox && leadEmail !== mailbox && recipients.includes(leadEmail)
  if (!inbound && !outbound) return null
  const parsed = Date.parse(input.sentAt)
  const createdAt = Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString()
  const description = (decodeGmailSnippet(input.snippet).trim() || input.subject.trim() || (outbound ? 'Email' : 'Email reply')).slice(0, 500)
  return {
    lead_id: input.leadId,
    activity_type: outbound ? 'email' : 'email_received',
    description,
    agent: outbound ? mailbox : null,
    created_at: createdAt,
    metadata: {
      source: 'gmail_sync',
      direction: outbound ? 'outbound' : 'inbound',
      from: fromAddr,
      to: input.toAddrs,
      subject: input.subject,
      provider: 'gmail',
      gmail_message_id: input.gmailMessageId,
      gmail_thread_id: input.gmailThreadId,
      ...(outbound ? { sent: true } : {}),
    },
  }
}

export async function loadLeadsForGmailMatch(db: SupabaseClient): Promise<LeadMatchRow[]> {
  const { data: leads } = await db
    .from('leads')
    .select('id, email, full_name, property_address')
    .or('email.not.is.null,property_address.not.is.null,full_name.not.is.null')
    .limit(5000)
  return (leads || []) as LeadMatchRow[]
}

type ThreadMessage = {
  id: string
  threadId: string
  fromAddr: string
  toAddrs: string[]
  ccAddrs: string[]
  subject: string
  snippet: string
  sentAt: string
}

type ThreadContext = {
  db: SupabaseClient
  mailbox: string
  leads: LeadMatchRow[]
  internalAddresses: readonly string[]
}

function threadCandidates(context: ThreadContext, message: ThreadMessage): string[] {
  return counterpartyLeadIds({
    mailbox: context.mailbox,
    fromAddr: message.fromAddr,
    toAddrs: message.toAddrs,
    ccAddrs: message.ccAddrs,
    leads: context.leads,
    internalAddresses: context.internalAddresses,
  })
}

// Keep a message with the lead it was first filed under, such as the lead an
// app send was addressed to, so duplicate lead rows do not each get a copy.
async function filedCandidateLeadId(context: ThreadContext, messageId: string, candidates: string[]): Promise<string | null> {
  const { data, error } = await context.db
    .from('lead_emails')
    .select('lead_id')
    .in('lead_id', candidates)
    .eq('gmail_message_id', messageId)
    .limit(1)
  if (error) {
    console.error('[gmail-sync] filed lead lookup failed:', error)
    return null
  }
  return (data as Array<{ lead_id: string }> | null)?.[0]?.lead_id ?? null
}

function leadEmailRow(context: ThreadContext, message: ThreadMessage, leadId: string) {
  return {
    lead_id: leadId,
    gmail_thread_id: message.threadId,
    gmail_message_id: message.id,
    subject: message.subject,
    from_address: message.fromAddr,
    to_addresses: message.toAddrs,
    cc_addresses: message.ccAddrs,
    body_snippet: message.snippet,
    sent_at: message.sentAt,
    direction: message.fromAddr === context.mailbox.toLowerCase() ? 'outbound' : 'inbound',
    synced_from_user: context.mailbox,
  }
}

type RecordedThreadActivity = { id: string; direction: 'inbound' | 'outbound' }

// One timeline row per Gmail message in this mailbox. The id comes from the
// message, so two sync runs racing on the same message insert it once.
async function recordThreadActivity(
  context: ThreadContext,
  message: ThreadMessage,
  leadId: string,
  candidates: string[],
): Promise<RecordedThreadActivity | null> {
  const activity = leadThreadActivity({
    leadId,
    leadEmail: context.leads.find((lead) => lead.id === leadId)?.email,
    mailbox: context.mailbox,
    fromAddr: message.fromAddr,
    toAddrs: message.toAddrs,
    ccAddrs: message.ccAddrs,
    subject: message.subject,
    snippet: message.snippet,
    sentAt: message.sentAt,
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    internalAddresses: context.internalAddresses,
  })
  if (!activity) return null
  const { data: existing, error: lookupError } = await context.db
    .from('lead_activities')
    .select('id')
    .in('lead_id', candidates)
    .contains('metadata', { gmail_message_id: message.id })
    .limit(1)
  if (lookupError) {
    console.error('[gmail-sync] activity lookup failed:', lookupError)
    return null
  }
  if (existing?.length) return null
  const id = stableWebhookActivityId('gmail-sync', `${context.mailbox.toLowerCase()}:${message.id}`)
  const { error } = await context.db.from('lead_activities').insert({
    id,
    ...activity,
  })
  if (error) {
    if (!isUniqueViolation(error)) console.error('[gmail-sync] activity insert failed:', error)
    return null
  }
  return { id, direction: activity.metadata.direction === 'outbound' ? 'outbound' : 'inbound' }
}

// Shared by manual Sync now and Pub/Sub history ingest. Upsert ignores a
// lead_id + gmail_message_id that is already stored, so a repeated push
// cannot insert a second CRM row for the same Gmail message.
export async function ingestGmailMessageStubs(input: {
  db: SupabaseClient
  accessToken: string
  userEmail: string
  stubs: GmailMessageStub[]
  leads: LeadMatchRow[]
  internalAddresses: readonly string[]
  fetchImpl?: typeof fetch
}): Promise<{ scanned: number; matched: number; inserted: number }> {
  const fetchImpl = input.fetchImpl || fetch
  const context: ThreadContext = {
    db: input.db,
    mailbox: input.userEmail,
    leads: input.leads,
    internalAddresses: input.internalAddresses,
  }
  const seen = new Set<string>()
  const stubs = input.stubs.filter((stub) => {
    if (!stub.id || seen.has(stub.id)) return false
    seen.add(stub.id)
    return true
  })

  let matched = 0
  let inserted = 0
  const inboundAlerts: Array<{ leadId: string; activityId: string; subject: string; snippet: string }> = []

  for (const stub of stubs) {
    const msgRes = await fetchImpl(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(stub.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } }
    )
    if (!msgRes.ok) continue
    const msg = await msgRes.json() as GmailMessage

    const fromHeader = header(msg, 'From')
    const fromAddr = (fromHeader.match(/<([^>]+)>/) || [null, fromHeader])[1]?.toLowerCase().trim() || ''
    const toAddrs = parseAddrList(header(msg, 'To'))
    const ccAddrs = parseAddrList(header(msg, 'Cc'))
    const subject = header(msg, 'Subject')
    const snippet = msg.snippet || ''
    const sentAt = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date(header(msg, 'Date')).toISOString()

    const message: ThreadMessage = {
      id: stub.id,
      threadId: msg.threadId || stub.threadId,
      fromAddr,
      toAddrs,
      ccAddrs,
      subject,
      snippet,
      sentAt,
    }
    // The legacy scan returns whichever lead row the database lists first,
    // so an exact counterparty address outranks it.
    const fallbackLeadId = matchLeadToMessage(fromAddr, [...toAddrs, ...ccAddrs], subject, snippet, input.leads)
    const candidates = threadCandidates(context, message)
    const leadId = candidates.length
      ? (await filedCandidateLeadId(context, stub.id, candidates))
        ?? (fallbackLeadId && candidates.includes(fallbackLeadId) ? fallbackLeadId : candidates[0])
      : fallbackLeadId
    if (!leadId) continue
    matched++

    const { error: insertError } = await input.db
      .from('lead_emails')
      .upsert(leadEmailRow(context, message, leadId), { onConflict: 'lead_id,gmail_message_id', ignoreDuplicates: true })

    if (!insertError) inserted++

    const recorded = candidates.includes(leadId)
      ? await recordThreadActivity(context, message, leadId, candidates)
      : null
    if (recorded?.direction === 'inbound') {
      inboundAlerts.push({
        leadId,
        activityId: recorded.id,
        subject,
        snippet,
      })
    }
  }

  if (inboundAlerts.length) {
    afterRequest(() => Promise.allSettled(inboundAlerts.map((alert) => notifyInboundEmail(alert))))
  }

  return { scanned: stubs.length, matched, inserted }
}

type StoredLeadEmail = {
  lead_id: string
  gmail_message_id: string | null
  gmail_thread_id: string | null
  from_address: string | null
  to_addresses: string[] | null
  cc_addresses: string[] | null
  subject: string | null
  body_snippet: string | null
  sent_at: string | null
}

// Mail stored before projection existed, or filed under a self-test lead, can
// fall out of the newest-100 Gmail list before the next run. Projects it from
// the stored headers without calling Gmail.
export async function backfillStoredThreadActivity(input: {
  db: SupabaseClient
  userEmail: string
  leads: LeadMatchRow[]
  internalAddresses: readonly string[]
  since: string
  skipMessageIds?: ReadonlySet<string>
}): Promise<number> {
  const context: ThreadContext = {
    db: input.db,
    mailbox: input.userEmail,
    leads: input.leads,
    internalAddresses: input.internalAddresses,
  }
  const { data, error } = await input.db
    .from('lead_emails')
    .select('lead_id, gmail_message_id, gmail_thread_id, from_address, to_addresses, cc_addresses, subject, body_snippet, sent_at')
    .eq('synced_from_user', input.userEmail)
    .gte('sent_at', input.since)
    .order('sent_at', { ascending: false })
    .limit(STORED_BACKFILL_LIMIT)
  if (error) {
    console.error('[gmail-sync] stored email lookup failed:', error)
    return 0
  }

  const byMessage = new Map<string, { row: StoredLeadEmail; leadIds: Set<string> }>()
  for (const row of (data || []) as StoredLeadEmail[]) {
    if (!row.gmail_message_id || input.skipMessageIds?.has(row.gmail_message_id)) continue
    const entry = byMessage.get(row.gmail_message_id) ?? { row, leadIds: new Set<string>() }
    entry.leadIds.add(row.lead_id)
    byMessage.set(row.gmail_message_id, entry)
  }

  let projected = 0
  for (const [messageId, { row, leadIds }] of byMessage) {
    const message: ThreadMessage = {
      id: messageId,
      threadId: row.gmail_thread_id || messageId,
      fromAddr: normalizedAddress(row.from_address),
      toAddrs: row.to_addresses || [],
      ccAddrs: row.cc_addresses || [],
      subject: row.subject || '',
      snippet: row.body_snippet || '',
      sentAt: row.sent_at || '',
    }
    const candidates = threadCandidates(context, message)
    if (!candidates.length) continue
    let leadId = candidates.find((id) => leadIds.has(id)) ?? (await filedCandidateLeadId(context, messageId, candidates))
    if (!leadId) {
      leadId = candidates[0]
      const { error: fileError } = await input.db
        .from('lead_emails')
        .upsert(leadEmailRow(context, message, leadId), { onConflict: 'lead_id,gmail_message_id', ignoreDuplicates: true })
      if (fileError) console.error('[gmail-sync] stored email refile failed:', fileError)
    }
    if (await recordThreadActivity(context, message, leadId, candidates)) projected++
  }
  return projected
}

// ---------------------------------------------------------------------------
// Sync recent Gmail messages for one user, match to leads, insert to lead_emails
// Returns { scanned, matched, inserted }
// ---------------------------------------------------------------------------
export async function syncUserGmail(userEmail: string, daysBack = 7): Promise<{
  scanned: number
  matched: number
  inserted: number
  backfilled?: number
  error?: string
}> {
  const db = supabaseAdmin()

  const { data: tokenRow } = await db
    .from('user_oauth_tokens')
    .select('*')
    .eq('user_email', userEmail)
    .eq('provider', 'google')
    .single()

  if (!tokenRow) {
    return { scanned: 0, matched: 0, inserted: 0, error: 'no_token' }
  }

  if (!hasGoogleOAuthConfig()) {
    return { scanned: 0, matched: 0, inserted: 0, error: 'google_oauth_not_configured' }
  }

  const tokenResult = await getValidAccessTokenResult(tokenRow as StoredToken)
  if (!tokenResult.accessToken) {
    return { scanned: 0, matched: 0, inserted: 0, error: tokenResult.error || 'token_refresh_failed' }
  }
  const accessToken = tokenResult.accessToken

  const leads = await loadLeadsForGmailMatch(db)
  if (leads.length === 0) {
    return { scanned: 0, matched: 0, inserted: 0 }
  }
  let internalAddresses: string[]
  try {
    internalAddresses = await loadGmailInternalAddresses(db)
  } catch (error) {
    console.error('[gmail-sync] internal address lookup failed:', error)
    return { scanned: 0, matched: 0, inserted: 0, error: 'internal_addresses_unavailable' }
  }

  // Search Gmail for recent messages. Pull sync stays available when Pub/Sub
  // push is not configured. newer_than includes All Mail, not only Inbox.
  const query = `newer_than:${daysBack}d`
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!listRes.ok) {
    return { scanned: 0, matched: 0, inserted: 0, error: `gmail_list_${listRes.status}` }
  }
  const listData = await listRes.json() as { messages?: GmailMessageStub[] }
  const messageStubs = listData.messages || []
  const ingested = await ingestGmailMessageStubs({
    db,
    accessToken,
    userEmail,
    stubs: messageStubs,
    leads,
    internalAddresses,
  })
  const backfilled = await backfillStoredThreadActivity({
    db,
    userEmail,
    leads,
    internalAddresses,
    since: new Date(Date.now() - daysBack * DAY_MS).toISOString(),
    skipMessageIds: new Set(messageStubs.map((stub) => stub.id)),
  })

  await db.from('user_oauth_tokens').update({
    last_sync_at: new Date().toISOString(),
  }).eq('id', tokenRow.id)

  return { ...ingested, backfilled }
}
