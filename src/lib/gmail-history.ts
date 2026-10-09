import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  ingestGmailMessageStubs,
  loadGmailInternalAddresses,
  loadLeadsForGmailMatch,
  syncUserGmail,
  type GmailMessageStub,
} from '@/lib/gmail-sync'

export type GmailHistoryRecord = {
  id?: string
  messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }>
}

const HISTORY_PAGE_LIMIT = 5
const HISTORY_MESSAGE_LIMIT = 40

export function stubsFromHistoryRecords(records: GmailHistoryRecord[]): GmailMessageStub[] {
  const seen = new Set<string>()
  const stubs: GmailMessageStub[] = []
  for (const record of records) {
    for (const added of record.messagesAdded || []) {
      const id = added.message?.id?.trim() || ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      stubs.push({ id, threadId: added.message?.threadId?.trim() || id })
    }
  }
  return stubs
}

export function historyCursorIsCaughtUp(startHistoryId: string | null, notificationHistoryId: string): boolean {
  if (!startHistoryId) return false
  try {
    return BigInt(notificationHistoryId) <= BigInt(startHistoryId)
  } catch {
    return false
  }
}

export type GmailHistoryIngestResult = {
  scanned: number
  matched: number
  inserted: number
  historyId: string
  mode: 'history' | 'history_partial' | 'fallback_sync' | 'caught_up'
  error?: string
}

async function defaultIngestStubs(
  accessToken: string,
  userEmail: string,
  stubs: GmailMessageStub[],
): Promise<{ scanned: number; matched: number; inserted: number }> {
  const db = supabaseAdmin()
  const leads = await loadLeadsForGmailMatch(db)
  if (leads.length === 0 || stubs.length === 0) {
    return { scanned: stubs.length, matched: 0, inserted: 0 }
  }
  const internalAddresses = await loadGmailInternalAddresses(db)
  return ingestGmailMessageStubs({ db, accessToken, userEmail, stubs, leads, internalAddresses })
}

export async function ingestGmailHistory(input: {
  userEmail: string
  accessToken: string
  startHistoryId: string | null
  notificationHistoryId: string
  fetchImpl?: typeof fetch
  ingestStubs?: (
    accessToken: string,
    userEmail: string,
    stubs: GmailMessageStub[],
  ) => Promise<{ scanned: number; matched: number; inserted: number }>
  syncFallback?: () => Promise<{ scanned: number; matched: number; inserted: number; error?: string }>
}): Promise<GmailHistoryIngestResult> {
  const fetchImpl = input.fetchImpl || fetch
  const ingestStubs = input.ingestStubs || defaultIngestStubs
  const syncFallback = input.syncFallback || (() => syncUserGmail(input.userEmail, 1))

  async function fallback(historyId: string): Promise<GmailHistoryIngestResult> {
    const synced = await syncFallback()
    let resolved = historyId
    if (!synced.error) {
      const profile = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      })
      if (profile.ok) {
        const body = await profile.json() as { historyId?: unknown }
        const profileHistoryId = String(body.historyId ?? '').trim()
        if (/^\d+$/.test(profileHistoryId)) resolved = profileHistoryId
      }
    }
    return {
      scanned: synced.scanned,
      matched: synced.matched,
      inserted: synced.inserted,
      historyId: resolved,
      mode: 'fallback_sync',
      error: synced.error,
    }
  }

  if (!input.startHistoryId) return fallback(input.notificationHistoryId)
  if (historyCursorIsCaughtUp(input.startHistoryId, input.notificationHistoryId)) {
    return {
      scanned: 0,
      matched: 0,
      inserted: 0,
      historyId: input.startHistoryId,
      mode: 'caught_up',
    }
  }

  const records: GmailHistoryRecord[] = []
  let pageToken = ''
  let latestHistoryId = input.notificationHistoryId
  let partial = false

  for (let page = 0; page < HISTORY_PAGE_LIMIT && !partial; page += 1) {
    const params = new URLSearchParams({
      startHistoryId: input.startHistoryId,
      historyTypes: 'messageAdded',
      maxResults: '100',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    })
    if (res.status === 404) return fallback(input.notificationHistoryId)
    if (!res.ok) {
      return {
        scanned: 0,
        matched: 0,
        inserted: 0,
        historyId: input.startHistoryId,
        mode: 'history',
        error: `gmail_history_${res.status}`,
      }
    }
    const body = await res.json() as {
      history?: GmailHistoryRecord[]
      historyId?: unknown
      nextPageToken?: unknown
    }
    for (const record of body.history || []) {
      if (stubsFromHistoryRecords(records).length >= HISTORY_MESSAGE_LIMIT) {
        partial = true
        break
      }
      records.push(record)
    }
    const bodyHistoryId = String(body.historyId ?? '').trim()
    if (/^\d+$/.test(bodyHistoryId)) latestHistoryId = bodyHistoryId
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : ''
    if (!pageToken) break
    if (page === HISTORY_PAGE_LIMIT - 1) partial = true
  }

  const ingested = await ingestStubs(input.accessToken, input.userEmail, stubsFromHistoryRecords(records))
  const lastRecordId = [...records].reverse().find((record) => record.id && /^\d+$/.test(String(record.id)))?.id
  return {
    ...ingested,
    historyId: partial && lastRecordId ? lastRecordId : latestHistoryId,
    mode: partial ? 'history_partial' : 'history',
  }
}
