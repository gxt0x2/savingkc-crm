/**
 * Copy historical inbound MMS into the private inbound-mms bucket.
 *
 * Dry-run is the default. Pass --apply to download Twilio media and update
 * lead_activities. The window is at most 30 days.
 *
 *   npx tsx scripts/backfill-inbound-mms.ts --days=30 --sid=MMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   npx tsx scripts/backfill-inbound-mms.ts --days=30 --apply
 */
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

function loadEnv(path: string) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}

const envFile = process.argv.find((arg) => arg.startsWith('--env-file='))?.slice('--env-file='.length)
for (const file of [envFile, '.env.local', '.env.production', '.env'].filter((file): file is string => Boolean(file))) {
  loadEnv(resolve(file))
}

const { supabaseAdmin } = await import('../src/lib/supabase/admin')
const {
  backfillInboundMmsActivities,
  inboundMmsBackfillSince,
  loadInboundMmsBackfillRows,
} = await import('../src/lib/server/inbound-mms-backfill')

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

const apply = process.argv.includes('--apply')
const days = Number(arg('days') ?? 30)
const limit = Number(arg('limit') ?? 100)
const messageSid = arg('sid')?.trim() || undefined

if (!Number.isInteger(days) || days < 1 || days > 30 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
  console.error('Usage: backfill-inbound-mms.ts [--apply] [--days=30] [--limit=100] [--sid=MM...]')
  process.exit(1)
}
if (messageSid && !/^MM[0-9a-f]{32}$/i.test(messageSid)) {
  console.error('message sid must be an MM sid')
  process.exit(1)
}

const db = supabaseAdmin()
const rows = await loadInboundMmsBackfillRows(db, {
  since: inboundMmsBackfillSince(days),
  messageSid,
  limit,
})
const report = await backfillInboundMmsActivities({
  rows,
  apply,
  save: async (row, patch) => {
    const sid = typeof row.metadata?.message_sid === 'string' ? row.metadata.message_sid : ''
    const { data, error } = await db.from('lead_activities')
      .update(patch)
      .eq('id', row.id)
      .eq('activity_type', 'sms')
      .eq('metadata->>message_sid', sid)
      .select('id')
      .maybeSingle()
    if (error || !data) throw new Error(error?.message || 'Inbound MMS activity update failed')
  },
})

console.log(JSON.stringify({ ...report, candidates: rows.length }, null, 2))
if (report.failed.length > 0) process.exit(1)
