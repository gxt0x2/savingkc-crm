import { NextRequest, NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import {
  MojoDialIngestError,
  MOJO_CALL_INGEST_CURSOR_KEY,
  MOJO_CALL_INGEST_ERROR_AT_KEY,
  MOJO_CALL_INGEST_ERROR_KEY,
  parseMojoDialBatchResult,
  syncMojoDialIngest,
  type MojoDialIngestStore,
} from '@/lib/server/mojo-dial-ingest'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 300

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
}

type Db = ReturnType<typeof supabaseAdmin>

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function ingestStore(db: Db): MojoDialIngestStore {
  return {
    async loadCursor() {
      const { data, error } = await db
        .from('system_config')
        .select('value')
        .eq('key', MOJO_CALL_INGEST_CURSOR_KEY)
        .maybeSingle()
      if (error) throw new MojoDialIngestError('ingest_unavailable', 'Mojo call ingest cursor could not be read.')
      return textValue(data?.value)
    },
    async saveState(values, now) {
      const rows = Object.entries(values).map(([key, value]) => ({
        key,
        value,
        updated_at: now.toISOString(),
      }))
      const { error } = await db.from('system_config').upsert(rows, { onConflict: 'key' })
      if (error) throw new MojoDialIngestError('ingest_unavailable', 'Mojo call ingest state could not be saved.')
    },
    async applyBatch(calls) {
      const { data, error } = await db.rpc('apply_mojo_dial_batch_v1', { p_calls: calls })
      if (error) throw new Error(error.message)
      return parseMojoDialBatchResult(data)
    },
  }
}

function sessionFromValue(value: unknown): string | null {
  if (typeof value === 'string') return textValue(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return textValue((value as { sessionId?: unknown }).sessionId)
}

async function loadStoredSession(db: Db): Promise<string | null> {
  const environmentSession = textValue(process.env.MOJO_SESSION_ID)
  const { data, error } = await db
    .from('system_config')
    .select('value')
    .eq('key', 'mojo_session_id')
    .maybeSingle()
  if (error) return environmentSession
  return sessionFromValue(data?.value) ?? environmentSession
}

function requestedWindow(request: NextRequest): { from: string | null; to: string | null } {
  const url = new URL(request.url)
  return {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  }
}

async function handle(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  const db = supabaseAdmin()
  const now = new Date()
  const store = ingestStore(db)
  const window = requestedWindow(request)
  try {
    const sessionId = await loadStoredSession(db)
    const result = await syncMojoDialIngest({
      now,
      from: window.from,
      to: window.to,
      sessionId,
      store,
    })
    return NextResponse.json(result, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const code = error instanceof MojoDialIngestError ? error.code : 'provider_unavailable'
    const message = error instanceof Error ? error.message : 'Mojo call ingest failed'
    try {
      await store.saveState({
        [MOJO_CALL_INGEST_ERROR_KEY]: message.slice(0, 180),
        [MOJO_CALL_INGEST_ERROR_AT_KEY]: now.toISOString(),
      }, now)
    } catch {
      // The failure response still reports the ingest error.
    }
    const status = code === 'invalid_window' ? 400 : 503
    return NextResponse.json(
      {
        ok: false,
        code,
        error: message,
        ...(error instanceof MojoDialIngestError && error.missing.length ? { missing: error.missing } : {}),
      },
      { status, headers: NO_STORE_HEADERS },
    )
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
