import {
  MOJO_MCP_AUTH_REQUIREMENTS,
  createMojoDialReader,
  type MojoDialReader,
} from './mojo-call-source'
import {
  chunkMojoDials,
  dedupeMojoDials,
  mojoDialIngestWindow,
  mojoDialWrite,
  centralDateKey,
  type MojoDialCapture,
  type MojoDialWrite,
} from './mojo-dial-outcome'

export const MOJO_CALL_INGEST_CURSOR_KEY = 'mojo_call_ingest_cursor'
export const MOJO_CALL_INGEST_OK_KEY = 'mojo_call_ingest_last_ok_at'
export const MOJO_CALL_INGEST_ERROR_KEY = 'mojo_call_ingest_last_error'
export const MOJO_CALL_INGEST_ERROR_AT_KEY = 'mojo_call_ingest_last_error_at'

export class MojoDialIngestError extends Error {
  constructor(
    public readonly code: 'credentials_missing' | 'session_expired' | 'provider_unavailable' | 'invalid_window' | 'ingest_unavailable',
    message: string,
    public readonly missing: string[] = [],
  ) {
    super(message)
    this.name = 'MojoDialIngestError'
  }
}

export type MojoDialBatchResult = {
  calls: number
  eventsInserted: number
  eventsReplayed: number
  phonesUpdated: number
}

export type MojoDialIngestStore = {
  loadCursor(): Promise<string | null>
  saveState(values: Record<string, string>, now: Date): Promise<void>
  applyBatch(calls: MojoDialWrite[]): Promise<MojoDialBatchResult>
}

export type MojoDialIngestResult = {
  ok: true
  source: string
  from: string
  to: string
  catchingUp: boolean
  cursor: string
  calls: number
  eventsInserted: number
  eventsReplayed: number
  phonesUpdated: number
}

export async function listAllMojoDials(reader: MojoDialReader, from: string, to: string): Promise<MojoDialCapture[]> {
  const dials: MojoDialCapture[] = []
  const seen = new Set<string>()
  let page = 1
  let totalPages = 1
  let totalCount = 0
  let received = 0
  do {
    const batch = await reader.listDials({ dateFrom: from, dateTo: to, page, pageSize: 500 })
    totalPages = batch.totalPages
    totalCount = batch.totalCount
    received += batch.results.length
    for (const dial of batch.results) {
      if (seen.has(dial.fact.record_id)) continue
      seen.add(dial.fact.record_id)
      dials.push(dial)
    }
    page += 1
    if (page > 50) throw new Error('mojo_call_page_limit')
  } while (page <= totalPages && totalPages > 0)
  if (received !== totalCount) throw new Error('mojo_call_page_incomplete')
  return dials
}

export function parseMojoDialBatchResult(value: unknown): MojoDialBatchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_mojo_dial_batch_result')
  const row = value as Record<string, unknown>
  const calls = numberField(row.calls)
  const eventsInserted = numberField(row.eventsInserted)
  const eventsReplayed = numberField(row.eventsReplayed)
  const phonesUpdated = numberField(row.phonesUpdated)
  if (calls == null || eventsInserted == null || eventsReplayed == null || phonesUpdated == null) {
    throw new Error('invalid_mojo_dial_batch_result')
  }
  return { calls, eventsInserted, eventsReplayed, phonesUpdated }
}

export async function syncMojoDialIngest(options: {
  now?: Date
  from?: string | null
  to?: string | null
  sessionId?: string | null
  env?: NodeJS.ProcessEnv
  reader?: MojoDialReader | null
  store: MojoDialIngestStore
  fetchImpl?: typeof fetch
}): Promise<MojoDialIngestResult> {
  const now = options.now ?? new Date()
  const env = options.env ?? process.env
  const selected = options.reader !== undefined
    ? { reader: options.reader, auth: { mode: options.reader ? 'access_token' as const : 'missing' as const, missing: options.reader ? [] : [...MOJO_MCP_AUTH_REQUIREMENTS.durableServerEnv] } }
    : createMojoDialReader({
      env,
      sessionId: options.sessionId,
      fetchImpl: options.fetchImpl,
    })
  if (!selected.reader) {
    const missing = [...new Set([
      'MOJO_SESSION_ID',
      MOJO_MCP_AUTH_REQUIREMENTS.optionalAccessTokenEnv,
      ...MOJO_MCP_AUTH_REQUIREMENTS.durableServerEnv,
    ])]
    throw new MojoDialIngestError(
      'credentials_missing',
      'Mojo call ingest has no stored session and no MCP credentials.',
      missing,
    )
  }

  let window: ReturnType<typeof mojoDialIngestWindow>
  try {
    window = mojoDialIngestWindow({
      cursor: await options.store.loadCursor(),
      today: centralDateKey(now),
      from: options.from,
      to: options.to,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_mojo_call_window'
    throw new MojoDialIngestError(
      message === 'mojo_dial_window_too_wide' ? 'invalid_window' : 'invalid_window',
      message === 'mojo_dial_window_too_wide'
        ? 'Mojo call ingest accepts at most two days per request.'
        : 'Mojo call ingest window is invalid.',
    )
  }

  let dials: MojoDialCapture[]
  try {
    dials = dedupeMojoDials(await listAllMojoDials(selected.reader, window.from, window.to))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'mojo_call_provider_failed'
    if (/session_expired|mojo_mcp_unauthorized/i.test(message)) {
      throw new MojoDialIngestError('session_expired', 'The stored Mojo session is no longer valid.')
    }
    throw new MojoDialIngestError('provider_unavailable', 'Mojo call history could not be read.')
  }

  const totals: MojoDialBatchResult = { calls: 0, eventsInserted: 0, eventsReplayed: 0, phonesUpdated: 0 }
  const writes = dials.map(mojoDialWrite)
  try {
    for (const batch of chunkMojoDials(writes)) {
      const applied = await options.store.applyBatch(batch)
      totals.calls += applied.calls
      totals.eventsInserted += applied.eventsInserted
      totals.eventsReplayed += applied.eventsReplayed
      totals.phonesUpdated += applied.phonesUpdated
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'mojo_dial_ingest_failed'
    throw new MojoDialIngestError('ingest_unavailable', message.slice(0, 180))
  }

  await options.store.saveState({
    [MOJO_CALL_INGEST_CURSOR_KEY]: window.nextCursor,
    [MOJO_CALL_INGEST_OK_KEY]: now.toISOString(),
    [MOJO_CALL_INGEST_ERROR_KEY]: '',
    [MOJO_CALL_INGEST_ERROR_AT_KEY]: '',
  }, now)

  return {
    ok: true,
    source: selected.reader.kind,
    from: window.from,
    to: window.to,
    catchingUp: window.catchingUp,
    cursor: window.nextCursor,
    ...totals,
  }
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}
