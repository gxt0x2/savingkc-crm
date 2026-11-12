import { conversationMmsViews, inboundSmsDisplayBody } from '@/lib/inbound-mms-view'
import {
  listTwilioMessageMedia,
  storeTwilioInboundMedia,
  TwilioMediaNotFoundError,
  type StoredInboundMms,
} from '@/lib/server/inbound-mms'

const INBOUND_DIRECTIONS = new Set(['received', 'inbound', 'in'])
const MMS_SID = /^MM[0-9a-f]{32}$/i
const PAGE_SIZE = 200

export const INBOUND_MMS_BACKFILL_MAX_DAYS = 30

export interface InboundMmsBackfillRow {
  id: string
  activity_type?: string
  description: string | null
  metadata: Record<string, unknown> | null
  created_at?: string
}

export interface InboundMmsBackfillReport {
  apply: boolean
  examined: number
  stored: number
  alreadyStored: number
  pending: number
  storedSids: string[]
  notFound: Array<{ activityId: string; messageSid: string; status: 404 }>
  empty: Array<{ activityId: string; messageSid: string }>
  failed: Array<{ activityId: string; messageSid: string; error: string }>
}

interface ActivityQuery {
  select: (columns: string) => ActivityQuery
  update: (patch: { description: string; metadata: Record<string, unknown> }) => ActivityQuery
  eq: (column: string, value: string) => ActivityQuery
  in: (column: string, values: readonly string[]) => ActivityQuery
  gte: (column: string, value: string) => ActivityQuery
  like: (column: string, value: string) => ActivityQuery
  order: (column: string, options: { ascending: boolean }) => ActivityQuery
  range: (from: number, to: number) => PromiseLike<{ data: InboundMmsBackfillRow[] | null; error: { message: string } | null }>
  maybeSingle: () => PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>
}

export interface InboundMmsBackfillDb {
  from: (table: 'lead_activities') => ActivityQuery
}

type Upload = (path: string, bytes: Uint8Array, contentType: string) => Promise<void>
type Save = (row: InboundMmsBackfillRow, patch: { description: string; metadata: Record<string, unknown> }) => Promise<void>

export function inboundMmsBackfillSince(days: number, now = Date.now()): string {
  if (!Number.isInteger(days) || days < 1 || days > INBOUND_MMS_BACKFILL_MAX_DAYS) {
    throw new Error('Backfill window must be 1 to 30 days')
  }
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString()
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return metadata as Record<string, unknown>
}

/** Inbound MM receipt. Skips the internal alert copy that repeats the same sid. */
export function isInboundMmsReceipt(metadata: unknown): boolean {
  const row = metadataRecord(metadata)
  if (!row) return false
  const sid = typeof row.message_sid === 'string' ? row.message_sid.trim() : ''
  if (!MMS_SID.test(sid)) return false
  const direction = typeof row.direction === 'string' ? row.direction.trim().toLowerCase() : ''
  if (!INBOUND_DIRECTIONS.has(direction)) return false
  if (typeof row.team_member === 'string' && row.team_member.trim()) return false
  return true
}

/** Receipts that never received the private media copy #802 writes. */
export function isHistoricalInboundMms(metadata: unknown): boolean {
  const row = metadataRecord(metadata)
  if (!row || !isInboundMmsReceipt(row)) return false
  return conversationMmsViews(row).length === 0
}

export async function saveInboundMmsBackfill(
  db: InboundMmsBackfillDb,
  row: InboundMmsBackfillRow,
  patch: { description: string; metadata: Record<string, unknown> },
): Promise<void> {
  const sid = typeof row.metadata?.message_sid === 'string' ? row.metadata.message_sid : ''
  const { data, error } = await db.from('lead_activities')
    .update(patch)
    .eq('id', row.id)
    .eq('activity_type', 'sms')
    .eq('metadata->>message_sid', sid)
    .select('id')
    .maybeSingle()
  if (error || !data) throw new Error('Inbound MMS activity update failed')
}

export async function loadInboundMmsBackfillRows(
  db: InboundMmsBackfillDb,
  input: { since: string; messageSid?: string; limit: number },
): Promise<InboundMmsBackfillRow[]> {
  const rows: InboundMmsBackfillRow[] = []
  let offset = 0
  while (rows.length < input.limit && offset <= 5000) {
    let query = db.from('lead_activities')
      .select('id, activity_type, description, metadata, created_at')
      .eq('activity_type', 'sms')
      .in('metadata->>direction', ['received', 'inbound', 'in'])
      .gte('created_at', input.since)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    query = input.messageSid
      ? query.eq('metadata->>message_sid', input.messageSid)
      : query.like('metadata->>message_sid', 'MM%')
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error('Inbound MMS backfill query failed')
    const batch = data ?? []
    for (const row of batch) {
      if (!isInboundMmsReceipt(row.metadata)) continue
      rows.push(row)
      if (rows.length >= input.limit) break
    }
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

function messageSid(row: InboundMmsBackfillRow): string {
  const sid = row.metadata && typeof row.metadata.message_sid === 'string' ? row.metadata.message_sid.trim() : ''
  return sid
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Backfill failed'
  return message.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 180)
}

export async function backfillInboundMmsActivities(input: {
  rows: InboundMmsBackfillRow[]
  apply: boolean
  fetchImpl?: typeof fetch
  upload?: Upload
  save: Save
}): Promise<InboundMmsBackfillReport> {
  const report: InboundMmsBackfillReport = {
    apply: input.apply,
    examined: 0,
    stored: 0,
    alreadyStored: 0,
    pending: 0,
    storedSids: [],
    notFound: [],
    empty: [],
    failed: [],
  }
  const fetchImpl = input.fetchImpl ?? fetch
  for (const row of input.rows) {
    if (!isInboundMmsReceipt(row.metadata)) continue
    report.examined += 1
    const sid = messageSid(row)
    const metadata = metadataRecord(row.metadata) ?? {}
    const existing = conversationMmsViews(metadata)
    if (existing.length > 0) {
      const current = row.description ?? ''
      if (!input.apply || current.trim()) {
        report.alreadyStored += 1
        continue
      }
      try {
        await input.save(row, { description: inboundSmsDisplayBody('', existing.length), metadata })
        report.alreadyStored += 1
      } catch (error) {
        report.failed.push({ activityId: row.id, messageSid: sid, error: publicError(error) })
      }
      continue
    }
    let media
    try {
      media = await listTwilioMessageMedia(sid, fetchImpl)
    } catch (error) {
      if (error instanceof TwilioMediaNotFoundError) {
        report.notFound.push({ activityId: row.id, messageSid: sid, status: 404 })
      } else {
        report.failed.push({ activityId: row.id, messageSid: sid, error: publicError(error) })
      }
      continue
    }
    if (media.length === 0) {
      report.empty.push({ activityId: row.id, messageSid: sid })
      continue
    }
    if (!input.apply) {
      report.pending += 1
      continue
    }
    let stored: StoredInboundMms[]
    try {
      stored = await storeTwilioInboundMedia({
        messageSid: sid,
        media,
        priorMetadata: metadata,
        fetchImpl,
        upload: input.upload,
      })
    } catch (error) {
      if (error instanceof TwilioMediaNotFoundError) {
        report.notFound.push({ activityId: row.id, messageSid: sid, status: 404 })
      } else {
        report.failed.push({ activityId: row.id, messageSid: sid, error: publicError(error) })
      }
      continue
    }
    if (stored.length === 0) {
      report.empty.push({ activityId: row.id, messageSid: sid })
      continue
    }
    const current = row.description ?? ''
    const description = current.trim() ? current : inboundSmsDisplayBody('', stored.length)
    try {
      await input.save(row, {
        description,
        metadata: { ...metadata, num_media: stored.length, mms: stored },
      })
    } catch (error) {
      report.failed.push({ activityId: row.id, messageSid: sid, error: publicError(error) })
      continue
    }
    report.stored += 1
    report.storedSids.push(sid)
  }
  return report
}
