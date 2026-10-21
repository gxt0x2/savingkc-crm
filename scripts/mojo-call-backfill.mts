import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMojoEnv, mojoSessionFile } from './mojo-session-health.mjs'
import {
  MOJO_CALL_BACKFILL_FROM,
  MOJO_CALL_BACKFILL_SESSIONS,
  MOJO_CALL_BACKFILL_TO,
  compareMojoCallBackfill,
  parseMojoCallBackfillArgs,
  readMojoSessionId,
  runMojoCallBackfill,
  type MojoCallDb,
  type MojoCallSource,
} from '../src/lib/server/mojo-call-ledger'
import { MOJO_MCP_AUTH_REQUIREMENTS, createMojoCallSource, mojoMcpCredentialState } from '../src/lib/server/mojo-call-source'

export async function executeMojoCallBackfill(options: {
  apply: boolean
  env?: NodeJS.ProcessEnv
  sessionId?: string | null
  source?: MojoCallSource | null
  db?: MojoCallDb
}) {
  const env = options.env ?? process.env
  const auth = mojoMcpCredentialState(env)
  const selected = options.source !== undefined
    ? { source: options.source, auth }
    : createMojoCallSource({ env, sessionId: options.sessionId })
  if (!selected.source) {
    return {
      dryRun: !options.apply,
      source: null,
      auth,
      requirements: MOJO_MCP_AUTH_REQUIREMENTS,
      window: { from: MOJO_CALL_BACKFILL_FROM, to: MOJO_CALL_BACKFILL_TO },
      written: 0,
    }
  }
  const result = await runMojoCallBackfill({
    source: selected.source,
    from: MOJO_CALL_BACKFILL_FROM,
    to: MOJO_CALL_BACKFILL_TO,
    apply: options.apply,
    db: options.db,
  })
  return {
    ...result,
    source: selected.source.kind,
    auth,
    requirements: selected.source.kind === 'mojo_session_recordings' ? MOJO_MCP_AUTH_REQUIREMENTS : undefined,
    comparison: result.comparison,
    fallbackCannotSatisfyExpectedCounts: selected.source.kind === 'mojo_session_recordings',
  }
}

async function databaseForApply(): Promise<MojoCallDb> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim()
  if (!url || !key) throw new Error('mojo_call_backfill_database_required')
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args)
      return { data, error: error ? { message: error.message } : null }
    },
  }
}

async function main() {
  loadMojoEnv()
  const args = parseMojoCallBackfillArgs(process.argv.slice(2))
  const sessionId = readMojoSessionId(mojoSessionFile())
  const db = args.apply ? await databaseForApply() : undefined
  const result = await executeMojoCallBackfill({ apply: args.apply, sessionId, db })
  const report = {
    dryRun: result.dryRun,
    source: result.source,
    authMode: result.auth.mode,
    missingCredentials: result.auth.missing,
    window: { from: MOJO_CALL_BACKFILL_FROM, to: MOJO_CALL_BACKFILL_TO },
    written: result.written,
    ...('summary' in result ? {
      calls: result.calls,
      skippedUnkeyed: result.skippedUnkeyed,
      dailyCalls: result.summary.dailyCalls,
      sessions: result.summary.sessions,
      callIds: result.summary.callIds,
      matchesExpected: result.comparison.matches,
      dailyMismatches: result.comparison.dailyMismatches,
      sessionMismatches: result.comparison.sessionMismatches,
      callIdsMatch: result.comparison.callIdsMatch,
      fallbackCannotSatisfyExpectedCounts: result.fallbackCannotSatisfyExpectedCounts,
    } : {
      expected: compareMojoCallBackfill({ dailyCalls: {}, sessions: {}, callIds: { min: null, max: null, count: 0 } }).expectedDaily,
      expectedSessions: MOJO_CALL_BACKFILL_SESSIONS.sessions,
      expectedCallIds: MOJO_CALL_BACKFILL_SESSIONS.callIds,
      officialAuth: MOJO_MCP_AUTH_REQUIREMENTS,
    }),
  }
  console.log(JSON.stringify(report, null, 2))
  if (args.apply && result.source == null) process.exitCode = 1
  if (!args.apply && result.source === 'mojo_mcp_list_calls' && 'comparison' in result && !result.comparison.matches) {
    process.exitCode = 1
  }
}

const isDirect = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'mojo_call_backfill_failed'
    console.error(message)
    process.exitCode = 1
  })
}
