/**
 * Plain-text body for a lead-matched Gmail message. Metadata sync stays the
 * first read; format=full runs only when a body is not already stored.
 * Per-user Gmail quota is 250 units/second and messages.get costs 5, so a
 * sync shares one small budget and stops when Gmail says the quota is spent.
 */

export const GMAIL_BODY_TEXT_CAP = 20_000
export const GMAIL_FULL_FETCH_BUDGET = 50
export const GMAIL_FULL_FETCH_GAP_MS = 120

const RATE_LIMIT = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export type GmailBodyQuota = {
  remaining: number
  stopped: boolean
  attempted: Set<string>
}

type GmailPart = {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

type BodyRow = { lead_id?: string | null; body_text?: string | null }

type BodyRead = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      in: (column: string, values: readonly string[]) => {
        limit: (count: number) => PromiseLike<{ data: BodyRow[] | null; error: { message?: string } | null }>
      }
    }
  }
  update: (patch: { body_text: string }) => {
    eq: (column: string, value: string) => {
      in: (column: string, values: readonly string[]) => {
        is: (column: string, value: null) => PromiseLike<{ error: { message?: string } | null }>
      }
    }
  }
}

export type LeadEmailBodyDb = {
  from: (table: 'lead_emails') => BodyRead
}

export function createGmailBodyQuota(limit = GMAIL_FULL_FETCH_BUDGET): GmailBodyQuota {
  return { remaining: limit, stopped: false, attempted: new Set() }
}

function entityCodePoint(codePoint: number, entity: string): string {
  const valid = Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)
  return valid ? String.fromCodePoint(codePoint) : entity
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase()
    if (lower.startsWith('#x')) return entityCodePoint(Number.parseInt(lower.slice(2), 16), entity)
    if (lower.startsWith('#')) return entityCodePoint(Number.parseInt(lower.slice(1), 10), entity)
    return NAMED_ENTITIES[lower] ?? entity
  })
}

export function decodeGmailBodyData(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.length % 4 === 0 ? normalized : normalized + '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(padded, 'base64').toString('utf8')
}

export function stripHtmlToText(html: string): string {
  const withoutQuotes = html
    .replace(/<div[^>]*class="[^"]*gmail_quote[^"]*"[\s\S]*$/i, '')
    .replace(/<blockquote\b[\s\S]*$/i, '')
  return decodeEntities(withoutQuotes
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function earliestIndex(text: string, indexes: number[]): number {
  const found = indexes.filter((index) => index >= 0)
  return found.length ? Math.min(...found) : -1
}

function trailingQuoteIndex(text: string): number {
  const lines = text.split('\n')
  const starts: number[] = []
  let cursor = 0
  for (const line of lines) {
    starts.push(cursor)
    cursor += line.length + 1
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('>')) continue
    if (lines.slice(index).every((line) => !line.trim() || line.trim().startsWith('>'))) return starts[index]
  }
  return -1
}

/** Drop a trailing reply quote when the marker is one Gmail and Outlook already use. */
export function dropQuotedReplyHistory(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const cut = earliestIndex(normalized, [
    normalized.search(/^\s*On .+ wrote:\s*$/im),
    normalized.search(/^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im),
    normalized.search(/^\s*Begin forwarded message:\s*$/im),
    normalized.search(/^\s*From:\s.+\n\s*Sent:\s.+/im),
    trailingQuoteIndex(normalized),
  ])
  const kept = (cut >= 0 ? normalized.slice(0, cut) : normalized).replace(/\n{3,}/g, '\n\n').trim()
  return kept.length <= GMAIL_BODY_TEXT_CAP ? kept : kept.slice(0, GMAIL_BODY_TEXT_CAP)
}

function collectParts(part: GmailPart | undefined, plain: string[], html: string[]) {
  if (!part) return
  const type = (part.mimeType || '').toLowerCase()
  if (part.body?.data && type.startsWith('text/plain')) plain.push(decodeGmailBodyData(part.body.data))
  else if (part.body?.data && type.startsWith('text/html')) html.push(decodeGmailBodyData(part.body.data))
  for (const child of part.parts || []) collectParts(child, plain, html)
}

export function plainTextFromGmailPayload(payload: GmailPart | undefined): string {
  const plain: string[] = []
  const html: string[] = []
  collectParts(payload, plain, html)
  const raw = plain.map((part) => part.trim()).filter(Boolean).join('\n\n')
    || html.map((part) => stripHtmlToText(part)).filter(Boolean).join('\n\n')
  return dropQuotedReplyHistory(raw)
}

async function readStoredBody(db: LeadEmailBodyDb, messageId: string, leadIds: readonly string[]): Promise<{ text: string; missing: boolean } | { text: null } | undefined> {
  const { data, error } = await db.from('lead_emails').select('lead_id, body_text').eq('gmail_message_id', messageId).in('lead_id', leadIds).limit(leadIds.length)
  if (error) {
    console.error('[gmail-sync] stored body lookup failed', error)
    return undefined
  }
  const rows = data ?? []
  const stored = rows.find((row) => typeof row.body_text === 'string')
  if (!stored) return { text: null }
  return { text: stored.body_text ?? '', missing: rows.some((row) => row.body_text == null) }
}

async function writeBodyIfMissing(db: LeadEmailBodyDb, messageId: string, leadIds: readonly string[], text: string) {
  const { error } = await db.from('lead_emails').update({ body_text: text }).eq('gmail_message_id', messageId).in('lead_id', leadIds).is('body_text', null)
  if (error) console.error('[gmail-sync] body_text update failed', error)
}

export async function fetchGmailPlainTextBody(input: {
  accessToken: string
  messageId: string
  quota: GmailBodyQuota
  fetchImpl?: typeof fetch
  gapMs?: number
}): Promise<string | null> {
  const quota = input.quota
  if (quota.stopped || quota.remaining <= 0 || quota.attempted.has(input.messageId)) return null
  quota.attempted.add(input.messageId)
  quota.remaining -= 1
  const gapMs = input.gapMs ?? 0
  if (gapMs > 0 && quota.attempted.size > 1) {
    await new Promise((resolve) => setTimeout(resolve, gapMs))
  }
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.messageId)}?format=full`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    )
    if (!response.ok) {
      const body = typeof response.text === 'function' ? await response.text().catch(() => '') : ''
      if (response.status === 429 || RATE_LIMIT.test(body)) quota.stopped = true
      console.error('[gmail-sync] full message fetch failed', input.messageId, response.status)
      return null
    }
    const message = await response.json() as { payload?: GmailPart }
    return plainTextFromGmailPayload(message.payload)
  } catch (error) {
    console.error('[gmail-sync] full message fetch failed', input.messageId, error)
    return null
  }
}

/** One counterparty lead. Paced when the caller is using the live Gmail client. */
export async function rememberMatchedGmailBody(input: {
  db: LeadEmailBodyDb
  accessToken: string
  messageId: string
  leadId: string
  quota: GmailBodyQuota
  fetchImpl?: typeof fetch
  paced: boolean
}): Promise<string | undefined> {
  const text = await fillGmailBodyText({
    db: input.db,
    accessToken: input.accessToken,
    messageId: input.messageId,
    leadIds: [input.leadId],
    quota: input.quota,
    fetchImpl: input.fetchImpl,
    gapMs: input.paced ? GMAIL_FULL_FETCH_GAP_MS : 0,
  })
  return typeof text === 'string' ? text : undefined
}

/** Body text for these leads. A stored value is reused; Gmail is called only when it is missing. */
export async function fillGmailBodyText(input: {
  db: LeadEmailBodyDb
  accessToken: string
  messageId: string
  leadIds: readonly string[]
  quota: GmailBodyQuota
  fetchImpl?: typeof fetch
  gapMs?: number
}): Promise<string | null> {
  if (!input.leadIds.length) return null
  const stored = await readStoredBody(input.db, input.messageId, input.leadIds)
  if (!stored) return null
  if (stored.text !== null) {
    if (stored.missing) await writeBodyIfMissing(input.db, input.messageId, input.leadIds, stored.text)
    return stored.text
  }
  const text = await fetchGmailPlainTextBody(input)
  if (typeof text !== 'string') return null
  await writeBodyIfMissing(input.db, input.messageId, input.leadIds, text)
  return text
}
