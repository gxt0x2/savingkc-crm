#!/usr/bin/env node
/**
 * Mojo Backfill Script
 * Pulls ALL call records from Mojo API since Feb 1, 2026 and syncs to CRM.
 *
 * Mojo API format:
 *   GET /v2/rest/reports/call-recording-report-data/?agents=[-1]&date_range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   Response: { recordings: [{ record_id, contact: {id, name}, agent_name, duration, audio, result, date }] }
 *
 * Usage:
 *   node scripts/mojo-backfill.mjs
 *   node scripts/mojo-backfill.mjs --start 2026-02-01 --end 2026-04-01
 *   node scripts/mojo-backfill.mjs --session <session_id>
 *   node scripts/mojo-backfill.mjs --min-duration 60   # Only sync calls >= 60 seconds
 */

import fs from 'fs'
import path from 'path'

// ── Config ──────────────────────────────────────────────────────────
const MOJO_BASE_URL = 'https://app71.mojosells.com'
const CRM_API_URL = 'https://crm.savingkc.com/api/mojo/sync'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'
const BATCH_SIZE = 10
const CRM_TIMEOUT = 180000   // 3 min — CRM does enrichment + transcription per call
const DELAY_BETWEEN_BATCHES_MS = 5000  // 5s between batches

// Date range defaults
const DEFAULT_START = '2026-02-01'
const DEFAULT_END = '2026-04-02'

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
  const argIdx = process.argv.indexOf('--session')
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    log('Using session ID from --session argument')
    return process.argv[argIdx + 1]
  }

  try {
    if (fs.existsSync(SESSION_FILE)) {
      const content = fs.readFileSync(SESSION_FILE, 'utf8')
      const session = JSON.parse(content)
      if (session.sessionId && !session.expired) {
        log(`Using session from file: ${SESSION_FILE}`)
        return session.sessionId
      }
    }
  } catch {}

  throw new Error(`Mojo session not found. Run scripts/mojo-extract-session.mjs or pass --session.`)
}

// ── CLI arg parsing ─────────────────────────────────────────────────
function getCliArg(flag, defaultValue) {
  const idx = process.argv.indexOf(flag)
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1]
  }
  return defaultValue
}

// ── Parse duration string "MM:SS" to seconds ────────────────────────
function parseDuration(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') return 0
  const parts = durationStr.split(':')
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1])
  }
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
  }
  return parseInt(durationStr) || 0
}

// ── Parse Mojo date "MM/DD/YYYY HH:MM AM/PM" to ISO ────────────────
function parseMojoDate(dateStr) {
  if (!dateStr) return new Date().toISOString()
  try {
    // "03/31/2026 01:25 PM" → Date
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) return d.toISOString()
  } catch {}
  return dateStr
}

// ── Parse Mojo recordings response ──────────────────────────────────
function parseRecordings(mojoResponse) {
  const recordings = mojoResponse.recordings || []
  const calls = []

  for (const rec of recordings) {
    try {
      const durationSec = parseDuration(rec.duration)
      const call = {
        record_id: String(rec.record_id || ''),
        contact_name: rec.contact?.name || 'Unknown',
        phone_number: '', // Mojo recording API doesn't include phone — CRM will look up by contact name
        property_address: '',
        city: '',
        state: '',
        zip: '',
        call_date: parseMojoDate(rec.date),
        call_duration: durationSec,
        disposition: rec.result || 'Unknown',
        agent_name: rec.agent_name || 'Unknown',
        notes: '',
        list_name: '',
        campaign_name: '',
        recording_url: rec.audio || '',
        mojo_contact_id: rec.contact?.id ? String(rec.contact.id) : '',
      }

      if (call.record_id) {
        calls.push(call)
      }
    } catch (err) {
      logError('Failed to parse recording', err)
    }
  }

  return calls
}

// ── Fetch contact details from Mojo (phone, notes, callbacks) ───────
async function fetchContactDetails(sessionId, contactId) {
  const result = { phone: '', notes: '', scheduledCallback: '', address: '', city: '', state: '', zip: '' }
  if (!contactId) return result
  try {
    const url = `${MOJO_BASE_URL}/v2/rest/contacts/${contactId}/`
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        cookie: `sessionid=${sessionId}`,
        referer: `${MOJO_BASE_URL}/`,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (response.ok) {
      const data = await response.json()
      // Phone
      result.phone = data.phone || data.phone_number || data.mobile || data.cell ||
             data.primary_phone || data.phone1 || ''
      // Notes — Mojo stores these in various fields
      const notesParts = []
      if (data.notes) notesParts.push(data.notes)
      if (data.description) notesParts.push(data.description)
      if (data.comment) notesParts.push(data.comment)
      if (data.last_note) notesParts.push(data.last_note)
      result.notes = notesParts.filter(Boolean).join('\n')
      // Scheduled callback / follow-up
      if (data.callback_date || data.scheduled_callback || data.next_call_date || data.follow_up_date) {
        result.scheduledCallback = data.callback_date || data.scheduled_callback || data.next_call_date || data.follow_up_date || ''
      }
      // Address
      result.address = data.address || data.property_address || data.street || ''
      result.city = data.city || ''
      result.state = data.state || ''
      result.zip = data.zip || data.zipcode || ''
    }
  } catch {}
  return result
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  log('='.repeat(60))
  log('Mojo Backfill — Starting')
  log('='.repeat(60))

  const sessionId = getSessionId()
  const startDate = getCliArg('--start', DEFAULT_START)
  const endDate = getCliArg('--end', DEFAULT_END)
  const minDuration = parseInt(getCliArg('--min-duration', '0'))

  log(`Session ID: ${sessionId.substring(0, 12)}...`)
  log(`Date range: ${startDate} to ${endDate}`)
  if (minDuration > 0) log(`Min duration filter: ${minDuration}s`)

  // ── Fetch all recordings ────────────────────────────────────────
  const url =
    `${MOJO_BASE_URL}/v2/rest/reports/call-recording-report-data/` +
    `?agents=[-1]&date_range=custom&from=${startDate}&to=${endDate}`

  log(`Fetching: ${url}`)
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      cookie: `sessionid=${sessionId}`,
      referer: `${MOJO_BASE_URL}/`,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      log('Session expired. Re-extract session and retry.')
      process.exit(1)
    }
    throw new Error(`Mojo API returned HTTP ${response.status}: ${response.statusText}`)
  }

  const data = await response.json()
  let allCalls = parseRecordings(data)
  log(`Fetched ${allCalls.length} total recordings`)

  // ── Apply duration filter ─────────────────────────────────────────
  if (minDuration > 0) {
    const before = allCalls.length
    allCalls = allCalls.filter(c => c.call_duration >= minDuration)
    log(`After duration filter (>=${minDuration}s): ${allCalls.length} calls (filtered ${before - allCalls.length})`)
  }

  // ── Duration stats ────────────────────────────────────────────────
  const over1min = allCalls.filter(c => c.call_duration >= 60).length
  const over5min = allCalls.filter(c => c.call_duration >= 300).length
  const over10min = allCalls.filter(c => c.call_duration >= 600).length
  log(`Duration breakdown: ${over1min} >= 1min, ${over5min} >= 5min, ${over10min} >= 10min`)

  // ── Disposition stats ─────────────────────────────────────────────
  const dispositions = {}
  for (const c of allCalls) {
    dispositions[c.disposition] = (dispositions[c.disposition] || 0) + 1
  }
  log(`Dispositions: ${JSON.stringify(dispositions)}`)

  if (allCalls.length === 0) {
    log('No calls to sync.')
    return
  }

  // ── Sort by date ascending ────────────────────────────────────────
  allCalls.sort((a, b) => {
    const da = new Date(a.call_date).getTime() || 0
    const db = new Date(b.call_date).getTime() || 0
    return da - db
  })

  log(`Earliest: ${allCalls[0].call_date} (${allCalls[0].contact_name})`)
  log(`Latest:   ${allCalls[allCalls.length - 1].call_date} (${allCalls[allCalls.length - 1].contact_name})`)

  // ── Enrich with phone, notes, address, callbacks from Mojo contacts ─
  log('')
  log('Enriching calls with contact details from Mojo (phone, notes, address, callbacks)...')
  const contactCache = new Map()
  let enriched = 0
  let notesFound = 0
  let callbacksFound = 0
  for (const call of allCalls) {
    if (call.mojo_contact_id) {
      let details
      if (contactCache.has(call.mojo_contact_id)) {
        details = contactCache.get(call.mojo_contact_id)
      } else {
        details = await fetchContactDetails(sessionId, call.mojo_contact_id)
        contactCache.set(call.mojo_contact_id, details)
        // Throttle contact API calls
        await sleep(200)
      }
      if (details.phone && !call.phone_number) {
        call.phone_number = details.phone
        enriched++
      }
      if (details.notes) {
        call.notes = details.notes
        notesFound++
      }
      if (details.scheduledCallback) {
        call.notes = (call.notes ? call.notes + '\n' : '') + `[Mojo Calendar] Scheduled follow-up: ${details.scheduledCallback}`
        callbacksFound++
      }
      if (details.address && !call.property_address) {
        call.property_address = details.address
        call.city = details.city || call.city
        call.state = details.state || call.state
        call.zip = details.zip || call.zip
      }
    }
  }
  log(`Enriched ${enriched}/${allCalls.length} with phone numbers (${contactCache.size} unique contacts)`)
  log(`Found ${notesFound} contacts with notes, ${callbacksFound} with scheduled callbacks`)

  // ── POST to CRM in batches ────────────────────────────────────────
  const totalBatches = Math.ceil(allCalls.length / BATCH_SIZE)
  log('')
  log(`Syncing ${allCalls.length} calls in ${totalBatches} batches of ${BATCH_SIZE}...`)

  let totalProcessed = 0
  let totalCreated = 0
  let totalUpdated = 0
  let totalSkipped = 0
  let totalAlerts = 0
  let batchErrors = 0

  for (let i = 0; i < totalBatches; i++) {
    const start = i * BATCH_SIZE
    const end = Math.min(start + BATCH_SIZE, allCalls.length)
    const batch = allCalls.slice(start, end)

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
  log(`Total fetched:   ${allCalls.length}`)
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

main().catch((err) => {
  logError('Unexpected fatal error', err)
  process.exit(1)
})
