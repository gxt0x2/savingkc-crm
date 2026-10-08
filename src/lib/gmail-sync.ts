import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { markOAuthConnected, persistOAuthHealth, readOAuthHealth } from '@/lib/oauth-health'

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

// Two directions land on the lead. A reply is mail the lead wrote into this
// mailbox. A send is mail this mailbox wrote to the lead's address, including
// a message composed in Gmail rather than the app. Newsletters addressed to
// the lead stay in lead_emails. The lead's own mailbox is not treated as the
// company sending that mail.
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
  const inbound = fromAddr === leadEmail && fromAddr !== mailbox
  const outbound = fromAddr === mailbox && leadEmail !== mailbox && recipients.includes(leadEmail)
  if (!inbound && !outbound) return null
  const parsed = Date.parse(input.sentAt)
  const createdAt = Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString()
  const description = (input.snippet.trim() || input.subject.trim() || (outbound ? 'Email' : 'Email reply')).slice(0, 500)
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

// Shared by manual Sync now and Pub/Sub history ingest. Upsert ignores a
// lead_id + gmail_message_id that is already stored, so a repeated push
// cannot insert a second CRM row for the same Gmail message.
export async function ingestGmailMessageStubs(input: {
  db: SupabaseClient
  accessToken: string
  userEmail: string
  stubs: GmailMessageStub[]
  leads: LeadMatchRow[]
  fetchImpl?: typeof fetch
}): Promise<{ scanned: number; matched: number; inserted: number }> {
  const fetchImpl = input.fetchImpl || fetch
  const seen = new Set<string>()
  const stubs = input.stubs.filter((stub) => {
    if (!stub.id || seen.has(stub.id)) return false
    seen.add(stub.id)
    return true
  })

  let matched = 0
  let inserted = 0

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

    const leadId = matchLeadToMessage(fromAddr, [...toAddrs, ...ccAddrs], subject, snippet, input.leads)
    if (!leadId) continue
    matched++

    const direction = fromAddr === input.userEmail.toLowerCase() ? 'outbound' : 'inbound'

    const { error: insertError } = await input.db
      .from('lead_emails')
      .upsert({
        lead_id: leadId,
        gmail_thread_id: msg.threadId || stub.threadId,
        gmail_message_id: stub.id,
        subject,
        from_address: fromAddr,
        to_addresses: toAddrs,
        cc_addresses: ccAddrs,
        body_snippet: snippet,
        sent_at: sentAt,
        direction,
        synced_from_user: input.userEmail,
      }, { onConflict: 'lead_id,gmail_message_id', ignoreDuplicates: true })

    if (!insertError) inserted++

    const threadActivity = leadThreadActivity({
      leadId,
      leadEmail: input.leads.find((lead) => lead.id === leadId)?.email,
      mailbox: input.userEmail,
      fromAddr,
      toAddrs,
      ccAddrs,
      subject,
      snippet,
      sentAt,
      gmailMessageId: stub.id,
      gmailThreadId: msg.threadId || stub.threadId,
    })
    if (threadActivity) {
      const { data: existing, error: lookupError } = await input.db
        .from('lead_activities')
        .select('id')
        .eq('lead_id', leadId)
        .contains('metadata', { gmail_message_id: stub.id })
        .limit(1)
      if (lookupError) {
        console.error('[gmail-sync] activity lookup failed:', lookupError)
      } else if (!existing?.length) {
        const { error: activityError } = await input.db.from('lead_activities').insert(threadActivity)
        if (activityError) console.error('[gmail-sync] activity insert failed:', activityError)
      }
    }
  }

  return { scanned: stubs.length, matched, inserted }
}

// ---------------------------------------------------------------------------
// Sync recent Gmail messages for one user, match to leads, insert to lead_emails
// Returns { scanned, matched, inserted }
// ---------------------------------------------------------------------------
export async function syncUserGmail(userEmail: string, daysBack = 7): Promise<{
  scanned: number
  matched: number
  inserted: number
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
  })

  await db.from('user_oauth_tokens').update({
    last_sync_at: new Date().toISOString(),
  }).eq('id', tokenRow.id)

  return ingested
}
