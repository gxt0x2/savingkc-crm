#!/usr/bin/env node
/**
 * Mojo Backfill Script
 * Pulls ALL call records from Mojo API since Feb 1, 2026 and syncs to CRM.
 *
 * Strategy:
 *   1. Try date_range=custom with start_date/end_date for the full range
 *   2. If that fails or returns 0 records, fall back to weekly chunks
 *   3. Parse records using the same logic as mojo-sync.mjs
 *   4. POST to CRM in batches of 20
 *
 * Usage:
 *   node scripts/mojo-backfill.mjs
 *   node scripts/mojo-backfill.mjs --start 2026-02-01 --end 2026-04-01
 *   node scripts/mojo-backfill.mjs --session <session_id>
 */

import fs from 'fs'
import path from 'path'

// ── Config ──────────────────────────────────────────────────────────
const MOJO_BASE_URL = 'https://app71.mojosells.com'
const CRM_API_URL = 'https://crm.savingkc.com/api/mojo/sync'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'
const HARDCODED_SESSION_ID = 'q5yf48bvcz0vx32ismobwicfbx71033w'
const BATCH_SIZE = 20
const REQUEST_TIMEOUT = 60000 // 60s for potentially large responses
const CRM_TIMEOUT = 120000   // 120s — CRM does enrichment + transcription per call
const DELAY_BETWEEN_BATCHES_MS = 2000  // Be gentle on the CRM
const DELAY_BETWEEN_FETCHES_MS = 1500  // Be gentle on Mojo

// Date range defaults
const DEFAULT_START = '2026-02-01'
const DEFAULT_END = '2026-04-01'

// ── Logging ─────────────────────────────────────────────────────────
const LOG_DIR = path.join(process.env.HOME || '/tmp', '.savingkc-logs')
const LOG_FILE = path.join(LOG_DIR, 'mojo-backfill.log')

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

function log(message) {
  const timestamp = new Date().toISOString()
  const logLine = `[${timestamp}] ${message}`
  console.log(logLine)
  fs.appendFileSync(LOG_FILE, logLine + '\n')
}

function logError(message, error) {
  const errorDetails = error instanceof Error ? error.message : String(error)
  const timestamp = new Date().toISOString()
  const logLine = `[${timestamp}] ERROR: ${message} — ${errorDetails}`
  console.error(logLine)
  fs.appendFileSync(LOG_FILE, logLine + '\n')
}

// ── Session handling ────────────────────────────────────────────────
function getSessionId() {
  // 1. CLI argument
  const argIdx = process.argv.indexOf('--session')
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    log('Using session ID from --session argument')
    return process.argv[argIdx + 1]
  }

  // 2. Session file
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const content = fs.readFileSync(SESSION_FILE, 'utf8')
      const session = JSON.parse(content)
      if (session.sessionId && !session.expired) {
        log(`Using session from file: ${SESSION_FILE}`)
        return session.sessionId
      }
      log('Session file found but session is expired or missing sessionId')
    }
  } catch (err) {
    logError('Failed to read session file', err)
  }

  // 3. Hardcoded fallback
  log('Using hardcoded session ID')
  return HARDCODED_SESSION_ID
}

// ── CLI arg parsing ─────────────────────────────────────────────────
function getCliDate(flag, defaultValue) {
  const idx = process.argv.indexOf(flag)
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1]
  }
  return defaultValue
}

// ── Mojo API headers ────────────────────────────────────────────────
function buildHeaders(sessionId) {
  return {
    accept: 'application/json, text/plain, */*',
    cookie: `sessionid=${sessionId}`,
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    referer: `${MOJO_BASE_URL}/`,
  }
}

// ── Parse call records (same logic as mojo-sync.mjs) ────────────────
function parseCallRecords(mojoResponse) {
  const calls = []

  let records = []
  if (Array.isArray(mojoResponse)) {
    records = mojoResponse
  } else if (mojoResponse.results && Array.isArray(mojoResponse.results)) {
    records = mojoResponse.results
  } else if (mojoResponse.data && Array.isArray(mojoResponse.data)) {
    records = mojoResponse.data
  }

  for (const record of records) {
    try {
      const call = {
        record_id: String(
          record.record_id ||
            record.recordId ||
            record.id ||
            record.call_id ||
            record.callId ||
            ''
        ),
        contact_name:
          record.contact_name ||
          record.contactName ||
          record.name ||
          record.contact?.name ||
          'Unknown',
        phone_number: String(
          record.phone_number ||
            record.phoneNumber ||
            record.phone ||
            record.contact?.phone ||
            ''
        ),
        property_address:
          record.property_address ||
          record.propertyAddress ||
          record.address ||
          record.contact?.address ||
          record.situs ||
          '',
        city: record.city || record.contact?.city || '',
        state: record.state || record.contact?.state || '',
        zip: record.zip || record.zipcode || record.contact?.zip || '',
        call_date:
          record.call_date ||
          record.callDate ||
          record.date ||
          record.created_at ||
          record.timestamp ||
          new Date().toISOString(),
        call_duration: parseInt(
          record.call_duration ||
            record.callDuration ||
            record.duration ||
            record.length ||
            '0'
        ),
        disposition:
          record.disposition ||
          record.status ||
          record.outcome ||
          record.result ||
          'Unknown',
        agent_name:
          record.agent_name ||
          record.agentName ||
          record.agent ||
          record.user?.name ||
          'Unknown',
        notes: record.notes || record.note || record.comments || '',
        list_name:
          record.list_name ||
          record.listName ||
          record.list ||
          record.campaign_list ||
          '',
        campaign_name:
          record.campaign_name ||
          record.campaignName ||
          record.campaign ||
          '',
        recording_url:
          record.recording_url ||
          record.recordingUrl ||
          record.recording ||
          record.audio_url ||
          record.audioUrl ||
          '',
      }

      // Only include calls with valid record_id and phone
      if (call.record_id && call.phone_number) {
        calls.push(call)
      }
    } catch (err) {
      logError('Failed to parse call record', err)
    }
  }

  return calls
}

// ── Fetch from Mojo API ─────────────────────────────────────────────
async function fetchMojoRecords(sessionId, startDate, endDate) {
  const url =
    `${MOJO_BASE_URL}/v2/rest/reports/call-recording-report-data/` +
    `?agents=[-2]&date_range=custom&start_date=${startDate}&end_date=${endDate}`

  log(`Fetching: ${url}`)
  const headers = buildHeaders(sessionId)

  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Session expired (HTTP ${response.status}). Re-extract session and retry.`)
    }
    throw new Error(`Mojo API returned HTTP ${response.status}: ${response.statusText}`)
  }

  const data = await response.json()
  const rawBytes = JSON.stringify(data).length
  log(`Response received (${rawBytes} bytes)`)

  return data
}

// ── Generate weekly chunks between two dates ────────────────────────
function generateWeeklyChunks(startDate, endDate) {
  const chunks = []
  let current = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')

  while (current < end) {
    const chunkStart = current.toISOString().split('T')[0]
    const nextWeek = new Date(current)
    nextWeek.setDate(nextWeek.getDate() + 7)
    const chunkEnd = nextWeek > end ? endDate : nextWeek.toISOString().split('T')[0]

    chunks.push({ start: chunkStart, end: chunkEnd })
    current = nextWeek
  }

  return chunks
}

// ── POST a batch to CRM ─────────────────────────────────────────────
async function postBatchToCRM(calls, batchNumber, totalBatches) {
  log(`Posting batch ${batchNumber}/${totalBatches} (${calls.length} calls) to CRM...`)

  const response = await fetch(CRM_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ calls }),
    signal: AbortSignal.timeout(CRM_TIMEOUT),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`CRM API returned HTTP ${response.status}: ${errorText}`)
  }

  const result = await response.json()
  log(
    `  Batch ${batchNumber} result: ` +
      `processed=${result.processed}, created=${result.created}, ` +
      `updated=${result.updated}, skipped=${result.skipped}, ` +
      `alerts=${result.alerts_sent}`
  )

  return result
}

// ── Sleep helper ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  log('='.repeat(60))
  log('Mojo Backfill — Starting')
  log('='.repeat(60))

  const sessionId = getSessionId()
  const startDate = getCliDate('--start', DEFAULT_START)
  const endDate = getCliDate('--end', DEFAULT_END)

  log(`Session ID: ${sessionId.substring(0, 12)}...`)
  log(`Date range: ${startDate} to ${endDate}`)

  let allCalls = []

  // ── Strategy 1: Full range in one request ─────────────────────────
  log('')
  log('Strategy 1: Fetching full date range in one request...')
  try {
    const data = await fetchMojoRecords(sessionId, startDate, endDate)
    const parsed = parseCallRecords(data)
    log(`Strategy 1 returned ${parsed.length} call records`)

    if (parsed.length > 0) {
      allCalls = parsed
    }
  } catch (err) {
    logError('Strategy 1 failed', err)
    // If session expired, bail immediately
    if (err.message && err.message.includes('Session expired')) {
      log('Cannot proceed without a valid session. Exiting.')
      process.exit(1)
    }
  }

  // ── Strategy 2: Weekly chunks (fallback) ──────────────────────────
  if (allCalls.length === 0) {
    log('')
    log('Strategy 2: Falling back to weekly chunks...')
    const chunks = generateWeeklyChunks(startDate, endDate)
    log(`Generated ${chunks.length} weekly chunks`)

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      log(`  Chunk ${i + 1}/${chunks.length}: ${chunk.start} to ${chunk.end}`)

      try {
        const data = await fetchMojoRecords(sessionId, chunk.start, chunk.end)
        const parsed = parseCallRecords(data)
        log(`  → ${parsed.length} records`)
        allCalls.push(...parsed)
      } catch (err) {
        logError(`  Chunk ${i + 1} failed`, err)
        if (err.message && err.message.includes('Session expired')) {
          log('Session expired during chunked fetch. Exiting.')
          process.exit(1)
        }
      }

      // Throttle between chunk requests
      if (i < chunks.length - 1) {
        await sleep(DELAY_BETWEEN_FETCHES_MS)
      }
    }
  }

  // ── Deduplicate by record_id ──────────────────────────────────────
  const seen = new Set()
  const uniqueCalls = []
  for (const call of allCalls) {
    if (!seen.has(call.record_id)) {
      seen.add(call.record_id)
      uniqueCalls.push(call)
    }
  }

  log('')
  log(`Total raw records: ${allCalls.length}`)
  log(`Unique records (after dedup): ${uniqueCalls.length}`)

  if (uniqueCalls.length === 0) {
    log('No call records found. Nothing to sync.')
    log('Backfill complete (0 records).')
    return
  }

  // ── Sort by call_date ascending so CRM processes in order ─────────
  uniqueCalls.sort((a, b) => {
    const da = new Date(a.call_date).getTime() || 0
    const db = new Date(b.call_date).getTime() || 0
    return da - db
  })

  log(`Earliest call: ${uniqueCalls[0].call_date}`)
  log(`Latest call:   ${uniqueCalls[uniqueCalls.length - 1].call_date}`)

  // ── POST to CRM in batches of BATCH_SIZE ──────────────────────────
  const totalBatches = Math.ceil(uniqueCalls.length / BATCH_SIZE)
  log('')
  log(`Syncing ${uniqueCalls.length} calls in ${totalBatches} batches of up to ${BATCH_SIZE}...`)

  let totalProcessed = 0
  let totalCreated = 0
  let totalUpdated = 0
  let totalSkipped = 0
  let totalAlerts = 0
  let batchErrors = 0

  for (let i = 0; i < totalBatches; i++) {
    const start = i * BATCH_SIZE
    const end = Math.min(start + BATCH_SIZE, uniqueCalls.length)
    const batch = uniqueCalls.slice(start, end)

    try {
      const result = await postBatchToCRM(batch, i + 1, totalBatches)
      totalProcessed += result.processed || 0
      totalCreated += result.created || 0
      totalUpdated += result.updated || 0
      totalSkipped += result.skipped || 0
      totalAlerts += result.alerts_sent || 0
    } catch (err) {
      logError(`Batch ${i + 1} failed`, err)
      batchErrors++
    }

    // Throttle between batches
    if (i < totalBatches - 1) {
      await sleep(DELAY_BETWEEN_BATCHES_MS)
    }
  }

  // ── Summary ───────────────────────────────────────────────────────
  log('')
  log('='.repeat(60))
  log('Backfill Summary')
  log('='.repeat(60))
  log(`Date range:      ${startDate} to ${endDate}`)
  log(`Total fetched:   ${uniqueCalls.length}`)
  log(`Batches sent:    ${totalBatches} (${batchErrors} failed)`)
  log(`CRM processed:   ${totalProcessed}`)
  log(`  Created:       ${totalCreated}`)
  log(`  Updated:       ${totalUpdated}`)
  log(`  Skipped (dup): ${totalSkipped}`)
  log(`  Alerts sent:   ${totalAlerts}`)
  log(`Log file:        ${LOG_FILE}`)
  log('='.repeat(60))

  if (batchErrors > 0) {
    log(`WARNING: ${batchErrors} batch(es) failed. Check log for details.`)
    process.exit(1)
  }

  log('Backfill complete.')
}

// ── Run ─────────────────────────────────────────────────────────────
main().catch((err) => {
  logError('Unexpected fatal error', err)
  process.exit(1)
})
