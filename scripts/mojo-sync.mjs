#!/usr/bin/env node
/**
 * Mojo Sync Script v3
 * Pulls call activity from Mojo's activity-stream API, syncs ONLY meaningful
 * conversations to CRM manifests.
 *
 * MEANINGFUL = Casey had a real conversation and dispositioned to:
 *   - "Follow Up" (group 7)
 *   - "Appointment Set" (group 4)
 *   - Qualified as lead (type 30)
 *   - Notes with substantial seller intel (timeline, price, motivation, condition)
 *
 * NON-MEANINGFUL (skipped — no lead created):
 *   - No answer, voicemail, hung up, dead lead, not yet interested, trash, busy
 *
 * Runs every 15 minutes (8am-5pm M-F) via cron.
 */

import fs from 'fs'
import path from 'path'

const MOJO_BASE_URL = 'https://app71.mojosells.com'
const CRM_API_URL = 'https://crm.savingkc.com/api/mojo/sync'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'
const STATE_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-sync-state.json'
const LOG_DIR = '/Users/ernestdodson/.openclaw/workspace/memory/logs'
const LOG_FILE = path.join(LOG_DIR, 'mojo-sync.log')

// Mojo activity type codes
const ACTIVITY_NOTE = 3
const ACTIVITY_GROUP = 11
const ACTIVITY_LEAD = 30

// Groups that indicate a meaningful conversation happened
const MEANINGFUL_GROUPS = new Set(['follow up', 'appointment set'])

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

// --- State management ---

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { lastActivityId: 0 }
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { lastActivityId: 0 }
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// --- Session management ---

function readSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
    return session.expired ? null : session
  } catch (err) {
    logError('Failed to read session file', err)
    return null
  }
}

function markSessionExpired() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ expired: true, updatedAt: new Date().toISOString() }, null, 2))
  } catch (err) {
    logError('Failed to mark session as expired', err)
  }
}

async function pushSessionToCRM(sessionId) {
  try {
    await fetch(CRM_API_URL.replace('/mojo/sync', '/admin/mojo-session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(10000),
    })
    log('Pushed Mojo session to CRM')
  } catch {
    // Best-effort
  }
}

// --- Mojo API ---

function mojoHeaders(sessionId) {
  return {
    accept: 'application/json, text/plain, */*',
    cookie: `sessionid=${sessionId}`,
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    referer: `${MOJO_BASE_URL}/`,
  }
}

/**
 * Fetch full contact details from Mojo (address, phone, notes, etc.)
 * Endpoint: /v2/rest/contacts/{contactId}/
 */
async function fetchContactDetails(sessionId, contactId) {
  const result = { phone: '', notes: '', address: '', city: '', state: '', zip: '', email: '' }
  if (!contactId) return result
  try {
    const url = `${MOJO_BASE_URL}/v2/rest/contacts/${contactId}/`
    const response = await fetch(url, {
      headers: mojoHeaders(sessionId),
      signal: AbortSignal.timeout(10000),
    })
    if (response.ok) {
      const data = await response.json()
      result.phone = data.phone || data.phone_number || data.mobile || data.cell ||
             data.primary_phone || data.phone1 || ''
      result.email = data.email || data.email_address || ''
      result.address = data.address || data.property_address || data.street || ''
      result.city = data.city || ''
      result.state = data.state || ''
      result.zip = data.zip || data.zipcode || ''
      const notesParts = []
      if (data.notes) notesParts.push(data.notes)
      if (data.description) notesParts.push(data.description)
      if (data.last_note) notesParts.push(data.last_note)
      result.notes = notesParts.filter(Boolean).join('\n')
      log(`  Contact ${contactId} details: addr="${result.address}", city="${result.city}", state="${result.state}", zip="${result.zip}"`)
    } else {
      log(`  Contact ${contactId} fetch failed: ${response.status}`)
    }
  } catch (err) {
    logError(`Failed to fetch contact ${contactId}`, err)
  }
  return result
}

async function fetchActivityStream(sessionId, page = 1) {
  const url = `${MOJO_BASE_URL}/v2/rest/home/activity-stream/?page=${page}`
  const resp = await fetch(url, {
    headers: mojoHeaders(sessionId),
    signal: AbortSignal.timeout(20000),
  })

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      markSessionExpired()
      throw new Error('session_expired')
    }
    throw new Error(`Mojo activity-stream returned ${resp.status}`)
  }

  const data = await resp.json()
  return data.activities || []
}

// --- Parse helpers ---

/**
 * Extract phone number from Casey's notes.
 * Casey puts the phone on the first line: "816-547-6163\ncontact and hung up"
 * Also check anywhere in the note for phone patterns.
 */
function extractPhone(noteContent) {
  if (!noteContent) return ''
  // First line phone pattern
  const firstLine = noteContent.match(/^(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/)
  if (firstLine) return firstLine[1].replace(/[-.\s]/g, '')
  // Anywhere in content
  const anywhere = noteContent.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/)
  if (anywhere) return anywhere[1].replace(/[-.\s]/g, '')
  return ''
}

/**
 * Check if notes contain meaningful seller intel.
 * Casey writes structured notes for real conversations:
 *   Timeline: 30-60 days
 *   Condition: good shape, some flooding
 *   Price: 160-185k
 *   Motivation: wants a clean slate
 */
function hasSellerIntel(noteContent) {
  if (!noteContent) return false
  const lower = noteContent.toLowerCase()

  // Structured intel keywords Casey uses
  if (lower.includes('timeline:') || lower.includes('motivation:') ||
      lower.includes('price:') || lower.includes('condition:') ||
      lower.includes('asking price') || lower.includes('wants to sell') ||
      lower.includes('appointment set') || lower.includes('rent back') ||
      lower.includes('equity') || lower.includes('foreclosure') ||
      lower.includes('inherited') || lower.includes('probate')) {
    return true
  }

  // Substantial free-form notes (not just "no contact 04/06")
  const lines = noteContent.split('\n').filter(l => l.trim())
  const textLength = noteContent.replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim().length
  if (lines.length >= 3 && textLength > 80) {
    return true
  }

  return false
}

/**
 * Parse Mojo timestamp "04/06/2026 01:40 PM" to ISO string
 */
function parseMojoTimestamp(ts) {
  try {
    const [datePart, timePart, ampm] = ts.split(' ')
    const [month, day, year] = datePart.split('/')
    let [hours, minutes] = timePart.split(':').map(Number)
    if (ampm === 'PM' && hours !== 12) hours += 12
    if (ampm === 'AM' && hours === 12) hours = 0
    const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`)
    return d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/**
 * Process activities into MEANINGFUL call records only.
 * Now fetches contact details (address, phone) from Mojo for each meaningful contact.
 */
async function buildCallRecords(activities, lastActivityId, sessionId) {
  const newActivities = activities
    .filter(a => a[0] > lastActivityId)
    .sort((a, b) => a[0] - b[0])

  if (newActivities.length === 0) return { calls: [], skippedCount: 0, maxId: lastActivityId }

  // Group by contact_id
  const contactMap = new Map()

  for (const activity of newActivities) {
    const [activityId, type, agentName, timestamp, details] = activity
    const contactId = details?.contact_id
    if (!contactId) continue

    if (!contactMap.has(contactId)) {
      contactMap.set(contactId, {
        contactId,
        contactName: details.contact_name || 'Unknown',
        agentName,
        timestamp,
        activityIds: [],
        phone: '',
        notes: '',
        groupName: '',
        isQualifiedLead: false,
      })
    }

    const entry = contactMap.get(contactId)
    entry.activityIds.push(activityId)
    entry.timestamp = timestamp

    switch (type) {
      case ACTIVITY_NOTE: {
        const content = details.contents || ''
        if (!entry.phone) entry.phone = extractPhone(content)
        if (content.length > entry.notes.length) entry.notes = content
        break
      }
      case ACTIVITY_GROUP: {
        entry.groupName = details.group_name || ''
        break
      }
      case ACTIVITY_LEAD: {
        entry.isQualifiedLead = true
        if (details.group_name) entry.groupName = details.group_name
        break
      }
    }
  }

  // Filter to MEANINGFUL only, then convert to call records
  const calls = []
  let skippedCount = 0

  for (const [contactId, entry] of contactMap) {
    const groupLower = entry.groupName.toLowerCase()

    // === MEANINGFUL CHECK ===
    const isMeaningfulGroup = MEANINGFUL_GROUPS.has(groupLower)
    const isMeaningfulNotes = hasSellerIntel(entry.notes)
    const isMeaningful = entry.isQualifiedLead || isMeaningfulGroup || isMeaningfulNotes

    if (!isMeaningful) {
      skippedCount++
      continue
    }

    // Map disposition
    let disposition = 'Interested'
    if (groupLower.includes('appointment')) disposition = 'Appointment Set'
    else if (groupLower.includes('follow up')) disposition = 'Callback Requested'

    // Clean notes — strip phone from first line
    let cleanNotes = entry.notes
    if (extractPhone(entry.notes)) {
      cleanNotes = entry.notes.replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim()
    }

    // Fetch full contact details from Mojo (address, phone, email)
    log(`  Fetching contact details for ${entry.contactName} (${contactId})...`)
    const contactDetails = await fetchContactDetails(sessionId, contactId)

    const call = {
      record_id: `mojo-activity-${contactId}-${entry.activityIds[0]}`,
      contact_name: entry.contactName,
      phone_number: entry.phone || contactDetails.phone,
      property_address: contactDetails.address,
      city: contactDetails.city,
      state: contactDetails.state,
      zip: contactDetails.zip,
      call_date: parseMojoTimestamp(entry.timestamp),
      call_duration: 0,
      disposition,
      agent_name: entry.agentName,
      notes: cleanNotes || contactDetails.notes,
      list_name: '',
      campaign_name: '',
      recording_url: '',
    }

    calls.push(call)
  }

  const maxId = Math.max(...newActivities.map(a => a[0]), lastActivityId)
  return { calls, skippedCount, maxId }
}

// --- Main sync ---

async function sync() {
  log('Starting Mojo sync (v3 — meaningful only)...')

  try {
    const session = readSession()
    if (!session?.sessionId) {
      log('No valid session found. Run session extraction first.')
      return { ok: false, error: 'no_session' }
    }

    log(`Using session: ${session.sessionId.substring(0, 20)}...`)
    await pushSessionToCRM(session.sessionId)

    const state = readState()
    log(`Last processed activity ID: ${state.lastActivityId}`)

    // Fetch activity stream
    log('Fetching activity stream page 1...')
    let activities = await fetchActivityStream(session.sessionId, 1)
    log(`Got ${activities.length} activities from page 1`)

    // Catch-up: if all page 1 activities are new, also fetch page 2
    if (activities.length > 0 && state.lastActivityId > 0) {
      const oldestOnPage = Math.min(...activities.map(a => a[0]))
      if (oldestOnPage > state.lastActivityId) {
        log('All page 1 activities are new — fetching page 2 for catch-up...')
        try {
          const page2 = await fetchActivityStream(session.sessionId, 2)
          if (page2.length > 0) {
            activities = [...activities, ...page2]
            log(`Total activities after page 2: ${activities.length}`)
          }
        } catch (err) {
          logError('Page 2 fetch failed (non-fatal)', err)
        }
      }
    }

    // Build MEANINGFUL call records only
    const { calls, skippedCount, maxId } = await buildCallRecords(activities, state.lastActivityId, session.sessionId)
    log(`Built ${calls.length} meaningful calls, skipped ${skippedCount} non-meaningful`)

    if (calls.length === 0) {
      if (maxId > state.lastActivityId) {
        writeState({ lastActivityId: maxId, lastSync: new Date().toISOString() })
        log(`Updated state: lastActivityId=${maxId}`)
      }
      log('No meaningful calls to sync')
      return { ok: true, processed: 0 }
    }

    // Log what we're syncing
    for (const c of calls) {
      log(`  → ${c.contact_name} (${c.phone_number || 'no phone'}) — ${c.disposition}`)
      if (c.notes) {
        const preview = c.notes.substring(0, 120).replace(/\n/g, ' ')
        log(`    Notes: ${preview}${c.notes.length > 120 ? '...' : ''}`)
      }
    }

    // POST to CRM
    log(`Posting ${calls.length} meaningful calls to CRM...`)
    const crmResponse = await fetch(CRM_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calls }),
      signal: AbortSignal.timeout(120000),
    })

    if (!crmResponse.ok) {
      const errorText = await crmResponse.text()
      throw new Error(`CRM API returned ${crmResponse.status}: ${errorText}`)
    }

    const crmResult = await crmResponse.json()
    log(`CRM sync: processed=${crmResult.processed}, created=${crmResult.created}, updated=${crmResult.updated}, skipped=${crmResult.skipped}, alerts=${crmResult.alerts_sent}`)

    // Update state
    writeState({ lastActivityId: maxId, lastSync: new Date().toISOString() })
    log(`Updated state: lastActivityId=${maxId}`)

    return { ok: true, ...crmResult }
  } catch (err) {
    logError('Sync failed', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

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
