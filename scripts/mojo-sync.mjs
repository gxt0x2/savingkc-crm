#!/usr/bin/env node
/**
 * Mojo Sync Script
 * Pulls new call records from Mojo API, syncs to CRM manifests
 * Runs every 15 minutes (8am-5pm M-F) via cron
 */

import fs from 'fs'
import path from 'path'

const MOJO_BASE_URL = 'https://app71.mojosells.com'
const CRM_API_URL = 'https://crm.savingkc.com/api/mojo/sync'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'
const LOG_DIR = '/Users/ernestdodson/.openclaw/workspace/memory/logs'
const LOG_FILE = path.join(LOG_DIR, 'mojo-sync.log')

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

function log(message) {
  const timestamp = new Date().toISOString()
  const logLine = `[${timestamp}] ${message}\n`
  console.log(logLine.trim())
  fs.appendFileSync(LOG_FILE, logLine)
}

function logError(message, error) {
  const timestamp = new Date().toISOString()
  const errorDetails = error instanceof Error ? error.message : String(error)
  const logLine = `[${timestamp}] ERROR: ${message} - ${errorDetails}\n`
  console.error(logLine.trim())
  fs.appendFileSync(LOG_FILE, logLine)
}

// Read session from file
function readSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) {
      return null
    }
    const content = fs.readFileSync(SESSION_FILE, 'utf8')
    const session = JSON.parse(content)
    if (session.expired) {
      return null
    }
    return session
  } catch (err) {
    logError('Failed to read session file', err)
    return null
  }
}

// Mark session as expired
function markSessionExpired() {
  try {
    const session = { expired: true, updatedAt: new Date().toISOString() }
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2))
  } catch (err) {
    logError('Failed to mark session as expired', err)
  }
}

// Parse Mojo call recording response
function parseCallRecords(mojoResponse) {
  const calls = []

  // Mojo API returns nested structure — walk it to find call records
  // Based on download-call-recordings.mjs, the response is likely:
  // { results: [ { ... call data ... } ] }
  // OR an array directly

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
      // Extract fields from Mojo response
      // Field names are guesses — adjust based on actual API response
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

// Main sync function
async function sync() {
  log('Starting Mojo sync...')

  try {
    // Step 1: Read session
    const session = readSession()
    if (!session || !session.sessionId) {
      log('No valid session found. Please run session extraction first.')
      return { ok: false, error: 'no_session' }
    }

    log(`Using session: ${session.sessionId.substring(0, 20)}...`)

    // Step 2: Fetch call records from Mojo
    const mojoUrl = `${MOJO_BASE_URL}/v2/rest/reports/call-recording-report-data/?agents=[-2]&date_range=today`
    log(`Fetching from: ${mojoUrl}`)

    const mojoHeaders = {
      accept: 'application/json, text/plain, */*',
      cookie: `sessionid=${session.sessionId}`,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      referer: `${MOJO_BASE_URL}/`,
    }

    const mojoResponse = await fetch(mojoUrl, {
      method: 'GET',
      headers: mojoHeaders,
      signal: AbortSignal.timeout(20000),
    })

    if (!mojoResponse.ok) {
      if (mojoResponse.status === 401 || mojoResponse.status === 403) {
        log('Session expired (401/403). Marking session as expired.')
        markSessionExpired()
        return { ok: false, error: 'session_expired' }
      }
      throw new Error(`Mojo API returned ${mojoResponse.status}`)
    }

    const mojoData = await mojoResponse.json()
    log(`Mojo API response received (${JSON.stringify(mojoData).length} bytes)`)

    // Step 3: Parse call records
    const calls = parseCallRecords(mojoData)
    log(`Parsed ${calls.length} call records`)

    if (calls.length === 0) {
      log('No calls to sync')
      return { ok: true, processed: 0 }
    }

    // Step 4: POST to CRM API
    log(`Posting ${calls.length} calls to CRM...`)
    const crmResponse = await fetch(CRM_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ calls }),
      signal: AbortSignal.timeout(60000),
    })

    if (!crmResponse.ok) {
      const errorText = await crmResponse.text()
      throw new Error(`CRM API returned ${crmResponse.status}: ${errorText}`)
    }

    const crmResult = await crmResponse.json()
    log(
      `CRM sync completed: processed=${crmResult.processed}, created=${crmResult.created}, updated=${crmResult.updated}, skipped=${crmResult.skipped}, alerts=${crmResult.alerts_sent}`
    )

    return { ok: true, ...crmResult }
  } catch (err) {
    logError('Sync failed', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Run sync
sync()
  .then((result) => {
    if (result.ok) {
      log('Sync completed successfully')
      process.exit(0)
    } else {
      log(`Sync failed: ${result.error}`)
      process.exit(1)
    }
  })
  .catch((err) => {
    logError('Unexpected error', err)
    process.exit(1)
  })
