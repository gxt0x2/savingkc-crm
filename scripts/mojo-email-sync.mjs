#!/usr/bin/env node
/**
 * Trigger the app-native Mojo email sync route.
 *
 * This is useful for manual backfills or local cron. The route itself uses
 * connected Gmail OAuth tokens and queues actionable Mojo notification emails
 * into mojo_call_queue.
 *
 * Usage:
 *   node scripts/mojo-email-sync.mjs
 *   node scripts/mojo-email-sync.mjs --days 30 --max 200
 *   node scripts/mojo-email-sync.mjs --user savingkc@example.com
 */

const CRM_BASE_URL = (process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/$/, '')
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || process.env.CRON_SECRET || process.env.DEPLOY_SECRET || ''

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function main() {
  if (!ADMIN_API_SECRET) {
    console.error('ADMIN_API_SECRET, CRON_SECRET, or DEPLOY_SECRET is required.')
    process.exit(1)
  }

  const url = new URL('/api/cron/sync-mojo-emails', CRM_BASE_URL)
  const days = getArg('--days')
  const max = getArg('--max')
  const user = getArg('--user')

  if (days) url.searchParams.set('days_back', days)
  if (max) url.searchParams.set('max_results', max)
  if (user) url.searchParams.set('user_email', user)

  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${ADMIN_API_SECRET}`,
    },
    signal: AbortSignal.timeout(120_000),
  })

  const body = await res.text()
  if (!res.ok) {
    console.error(`Mojo email sync failed (${res.status}): ${body}`)
    process.exit(1)
  }

  console.log(body)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
