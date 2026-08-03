import { supabaseAdmin } from '@/lib/supabase/admin'
import { getValidAccessTokenResult, hasGoogleOAuthConfig, type StoredToken } from '@/lib/gmail-sync'

interface GmailHeader {
  name: string
  value: string
}

interface GmailPart {
  mimeType?: string
  headers?: GmailHeader[]
  body?: {
    data?: string
  }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  payload?: GmailPart
  snippet?: string
}

interface GmailMessageStub {
  id: string
  threadId: string
}

interface MojoEmailContact {
  first_name?: string
  last_name?: string
  owner_name?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  state?: string
  zip_code?: string
  notes?: string
  call_recording_url?: string
  mojo_group: string
  disposition: string
}

interface MojoEmailCallRecord {
  record_id: string
  contact_name: string
  phone_number: string
  property_address: string
  city: string
  state: string
  zip: string
  call_date: string
  call_duration: number
  disposition: string
  agent_name: string
  notes?: string
  list_name?: string
  campaign_name?: string
  recording_url?: string
  follow_up_date?: string
  email?: string
}

export interface MojoEmailSyncResult {
  user_email: string
  scanned: number
  queued: number
  skipped: number
  failed: number
  error?: string
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function bodyTextFromPart(part?: GmailPart): string {
  if (!part) return ''

  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data)
  }

  if (part.mimeType === 'text/html' && part.body?.data) {
    return stripHtml(decodeBase64Url(part.body.data))
  }

  const childTexts = (part.parts || [])
    .map(bodyTextFromPart)
    .filter(Boolean)

  return childTexts.join('\n\n')
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function fromAddress(fromHeader: string): string {
  return (fromHeader.match(/<([^>]+)>/) || [null, fromHeader])[1]?.toLowerCase().trim() || ''
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const value = match?.[1]?.trim()
    if (value && value.length > 1) {
      return value.replace(/[|,;]+$/g, '').trim()
    }
  }
  return ''
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

function dateFromMessage(msg: GmailMessage): string {
  const internalDate = msg.internalDate ? Number(msg.internalDate) : NaN
  if (Number.isFinite(internalDate)) {
    return new Date(internalDate).toISOString()
  }

  const dateHeader = header(msg, 'Date')
  const parsed = new Date(dateHeader)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return new Date().toISOString()
}

function isLikelyMojoEmail(from: string, subject: string, body: string): boolean {
  const haystack = `${from} ${subject} ${body.slice(0, 1500)}`.toLowerCase()
  return haystack.includes('mojo') || haystack.includes('mojosells') || haystack.includes('action plan')
}

function dispositionFromText(subject: string, body: string): { group: string; disposition: string; actionable: boolean } {
  const text = `${subject} ${body}`.toLowerCase()

  if (text.includes('appointment')) {
    return { group: 'Appointment Set', disposition: 'Appointment Set', actionable: true }
  }

  if (text.includes('follow up') || text.includes('follow-up') || text.includes('callback')) {
    return { group: 'Follow Up', disposition: 'Callback Requested', actionable: true }
  }

  if (text.includes('qualified') || text.includes('interested') || text.includes('motivated') || text.includes('lead')) {
    return { group: 'Mojo Lead', disposition: 'Interested', actionable: true }
  }

  return { group: 'Mojo Lead', disposition: 'Mojo Email Notice', actionable: false }
}

function extractContactFromBody(body: string, subject: string): MojoEmailContact {
  const disposition = dispositionFromText(subject, body)
  const contact: MojoEmailContact = {
    mojo_group: disposition.group,
    disposition: disposition.disposition,
  }

  contact.first_name = firstMatch(body, [
    /(?:first\s*name|fname)\s*[:=-]\s*(.+?)(?:\n|$|,|\|)/i,
  ]) || undefined

  contact.last_name = firstMatch(body, [
    /(?:last\s*name|lname)\s*[:=-]\s*(.+?)(?:\n|$|,|\|)/i,
  ]) || undefined

  contact.owner_name = firstMatch(body, [
    /(?:owner|property\s*owner|owner\s*name|name)\s*[:=-]\s*(.+?)(?:\n|$|\|)/i,
  ]) || undefined

  contact.phone = firstMatch(body, [
    /(?:phone|primary\s*phone|cell|mobile|tel)\s*[:=-]\s*([+\d\s().-]+)/i,
    /(\+?1?\s*\(?\d{3}\)?\s*[-.\s]?\d{3}\s*[-.\s]?\d{4})/,
  ]) || undefined

  contact.email = firstMatch(body, [
    /(?:email|e-mail)\s*[:=-]\s*([^\s,|]+@[^\s,|]+)/i,
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
  ]) || undefined

  contact.address = firstMatch(body, [
    /(?:property\s*address|address|street)\s*[:=-]\s*(.+?)(?:\n|$|\|)/i,
  ]) || undefined

  contact.city = firstMatch(body, [
    /(?:city)\s*[:=-]\s*(.+?)(?:\n|$|,|\|)/i,
  ]) || undefined

  contact.state = firstMatch(body, [
    /(?:state)\s*[:=-]\s*([A-Za-z]{2,})\b/i,
  ]) || undefined

  contact.zip_code = firstMatch(body, [
    /(?:zip|postal|zip\s*code)\s*[:=-]\s*(\d{5}(?:-\d{4})?)/i,
  ]) || undefined

  contact.notes = firstMatch(body, [
    /(?:notes?|comments?)\s*[:=-]\s*(.+?)(?:\n\n|$)/i,
  ]) || undefined

  contact.call_recording_url = firstMatch(body, [
    /(?:recording|call\s*recording)\s*[:=-]\s*(https?:\/\/\S+)/i,
    /(https?:\/\/\S*recording\S*)/i,
  ]) || undefined

  if (contact.owner_name && !contact.first_name) {
    const [firstName, ...rest] = contact.owner_name.split(/\s+/)
    contact.first_name = firstName
    contact.last_name = rest.join(' ') || contact.last_name
  }

  if (!contact.owner_name && (contact.first_name || contact.last_name)) {
    contact.owner_name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
  }

  if (!contact.owner_name) {
    const subjectName = subject.match(/(?:contact|lead|new)\s*[:\s]+(.+?)(?:\s*[-|]|$)/i)?.[1]?.trim()
    if (subjectName) contact.owner_name = subjectName
  }

  return contact
}

function buildCallRecord(msg: GmailMessage, subject: string, from: string, body: string): MojoEmailCallRecord | null {
  const contact = extractContactFromBody(body, subject)
  const disposition = dispositionFromText(subject, body)
  const phone = contact.phone ? normalizePhone(contact.phone) : ''
  const hasContactMethod = Boolean(phone || contact.email)

  if (!disposition.actionable || !hasContactMethod) {
    return null
  }

  const noteParts = [
    `Imported from Mojo notification email.`,
    `Subject: ${subject}`,
    `From: ${from}`,
    `Mojo Group: ${contact.mojo_group}`,
  ]

  if (contact.notes) {
    noteParts.push(`Notes: ${contact.notes}`)
  }

  const bodySnippet = body.replace(/\s+/g, ' ').trim().slice(0, 1200)
  if (bodySnippet) {
    noteParts.push(`Email body: ${bodySnippet}`)
  }

  return {
    record_id: `mojo-email-${msg.id}`,
    contact_name: contact.owner_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Mojo Lead',
    phone_number: phone,
    property_address: contact.address || '',
    city: contact.city || '',
    state: contact.state || '',
    zip: contact.zip_code || '',
    call_date: dateFromMessage(msg),
    call_duration: 0,
    disposition: contact.disposition,
    agent_name: 'Mojo Email Sync',
    notes: noteParts.join('\n'),
    list_name: contact.mojo_group,
    campaign_name: 'Mojo notification email',
    recording_url: contact.call_recording_url || '',
    email: contact.email,
  }
}

async function listMojoMessages(accessToken: string, daysBack: number, maxResults: number): Promise<GmailMessageStub[]> {
  const queries = [
    `newer_than:${daysBack}d from:mojosells`,
    `newer_than:${daysBack}d from:mojo`,
    `newer_than:${daysBack}d subject:"Appointment Set"`,
    `newer_than:${daysBack}d subject:"Follow Up"`,
    `newer_than:${daysBack}d subject:Mojo`,
  ]

  const messages = new Map<string, GmailMessageStub>()

  for (const query of queries) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
    url.searchParams.set('q', query)
    url.searchParams.set('maxResults', String(maxResults))

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      throw new Error(`gmail_list_${res.status}`)
    }

    const data = await res.json() as { messages?: GmailMessageStub[] }
    for (const message of data.messages || []) {
      messages.set(message.id, message)
    }
  }

  return Array.from(messages.values()).slice(0, maxResults)
}

async function fetchGmailMessage(accessToken: string, id: string): Promise<GmailMessage | null> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`)
  url.searchParams.set('format', 'full')

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) return null
  return await res.json() as GmailMessage
}

export async function syncUserMojoEmails(
  userEmail: string,
  daysBack = 7,
  maxResults = 50
): Promise<MojoEmailSyncResult> {
  const db = supabaseAdmin()

  const { data: tokenRow } = await db
    .from('user_oauth_tokens')
    .select('*')
    .eq('user_email', userEmail)
    .eq('provider', 'google')
    .single()

  if (!tokenRow) {
    return { user_email: userEmail, scanned: 0, queued: 0, skipped: 0, failed: 0, error: 'no_token' }
  }

  if (!hasGoogleOAuthConfig()) {
    return { user_email: userEmail, scanned: 0, queued: 0, skipped: 0, failed: 0, error: 'google_oauth_not_configured' }
  }

  const tokenResult = await getValidAccessTokenResult(tokenRow as StoredToken)
  if (!tokenResult.accessToken) {
    return {
      user_email: userEmail,
      scanned: 0,
      queued: 0,
      skipped: 0,
      failed: 0,
      error: tokenResult.error || 'token_refresh_failed',
    }
  }
  const accessToken = tokenResult.accessToken

  let stubs: GmailMessageStub[]
  try {
    stubs = await listMojoMessages(accessToken, daysBack, maxResults)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'gmail_list_failed'
    return { user_email: userEmail, scanned: 0, queued: 0, skipped: 0, failed: 0, error: message }
  }

  let queued = 0
  let skipped = 0
  let failed = 0

  for (const stub of stubs) {
    const msg = await fetchGmailMessage(accessToken, stub.id)
    if (!msg) {
      failed++
      continue
    }

    const subject = header(msg, 'Subject')
    const from = fromAddress(header(msg, 'From'))
    const body = bodyTextFromPart(msg.payload) || msg.snippet || ''

    if (!isLikelyMojoEmail(from, subject, body)) {
      skipped++
      continue
    }

    const call = buildCallRecord(msg, subject, from, body)
    if (!call) {
      skipped++
      continue
    }

    const { error } = await db
      .from('mojo_call_queue')
      .insert({
        record_id: call.record_id,
        payload: call,
        status: 'pending',
      })

    if (!error) {
      queued++
      continue
    }

    if (error.code === '23505') {
      skipped++
    } else {
      failed++
      console.error('[mojo-email-sync] Queue insert failed:', error.message)
    }
  }

  return {
    user_email: userEmail,
    scanned: stubs.length,
    queued,
    skipped,
    failed,
  }
}
