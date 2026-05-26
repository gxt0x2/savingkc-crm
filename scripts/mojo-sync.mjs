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
const CRM_BASE_URL = (process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/$/, '')
const CRM_API_URL = process.env.CRM_API_URL || `${CRM_BASE_URL}/api/mojo/sync`
const CRM_CONFIG_URL = process.env.CRM_CONFIG_URL || `${CRM_BASE_URL}/api/admin/system-config`
const CRM_QUEUE_URL = process.env.CRM_QUEUE_URL || `${CRM_BASE_URL}/api/cron/process-mojo-queue`
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || process.env.CRON_SECRET || process.env.DEPLOY_SECRET || ''
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'
const STATE_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-sync-state.json'
const LOG_DIR = '/Users/ernestdodson/.openclaw/workspace/memory/logs'
const LOG_FILE = path.join(LOG_DIR, 'mojo-sync.log')

// Mojo activity type codes
const ACTIVITY_NOTE = 3
const ACTIVITY_APPOINTMENT = 5
const ACTIVITY_FOLLOWUP = 6
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

function adminHeaders(base = {}) {
  return ADMIN_API_SECRET
    ? { ...base, authorization: `Bearer ${ADMIN_API_SECRET}` }
    : base
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

// --- Delta timestamp management (stored in Supabase via CRM API) ---

async function readLastSyncTimestamp() {
  try {
    const res = await fetch(`${CRM_CONFIG_URL}?key=last_mojo_sync_timestamp`, {
      headers: adminHeaders(),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      log(`Config read failed (${res.status}) — using epoch`)
      return new Date(0).toISOString()
    }
    const data = await res.json()
    return data.value || new Date(0).toISOString()
  } catch (err) {
    logError('Failed to read last_mojo_sync_timestamp from CRM — using epoch', err)
    return new Date(0).toISOString()
  }
}

async function writeLastSyncTimestamp(timestamp) {
  try {
    const res = await fetch(CRM_CONFIG_URL, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ key: 'last_mojo_sync_timestamp', value: timestamp }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      log(`Config write failed (${res.status})`)
    } else {
      log(`Updated last_mojo_sync_timestamp to ${timestamp}`)
    }
  } catch (err) {
    logError('Failed to write last_mojo_sync_timestamp to CRM', err)
  }
}

async function processMojoQueue(reason = 'scheduled_sync') {
  try {
    const res = await fetch(CRM_QUEUE_URL, {
      headers: adminHeaders({ accept: 'application/json' }),
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) {
      log(`Queue processor failed (${res.status}) during ${reason}`)
      return
    }
    const result = await res.json().catch(() => null)
    if (result) {
      log(`Queue processor: processed=${result.processed ?? 0}, failed=${result.failed ?? 0}, pending batch=${result.total_claimed ?? 0}`)
    }
  } catch (err) {
    logError(`Queue processor failed during ${reason}`, err)
  }
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
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
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
 * CORRECT endpoint: /v2/rest/contacts/data/{contactId}/
 * (NOT /v2/rest/contacts/{id}/ — that's a SPA route that returns HTML)
 */
async function fetchContactDetails(sessionId, contactId) {
  const result = { phone: '', notes: '', address: '', city: '', state: '', zip: '', email: '', followUpDate: '' }
  if (!contactId) return result
  try {
    const url = `${MOJO_BASE_URL}/v2/rest/contacts/data/${contactId}/`
    const response = await fetch(url, {
      headers: mojoHeaders(sessionId),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) {
      log(`  Contact ${contactId} fetch failed: ${response.status}`)
      return result
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('json')) {
      log(`  Contact ${contactId} returned non-JSON (${contentType}) — likely SPA redirect`)
      return result
    }

    const data = await response.json()

    // Address fields
    result.address = data.address || data.full_address || ''
    result.city = data.city || ''
    result.state = data.state || ''
    result.zip = data.zip_code || data.zip || ''

    // Phone from mediainfo_set (type 3 = primary phone, type 2 = secondary)
    if (data.mediainfo_set && Array.isArray(data.mediainfo_set)) {
      const primaryPhone = data.mediainfo_set.find(m => m.type === 3 && m.value)
      const anyPhone = data.mediainfo_set.find(m => (m.type === 2 || m.type === 3) && m.value)
      const emailEntry = data.mediainfo_set.find(m => m.type === 4 && m.value)
      result.phone = (primaryPhone || anyPhone)?.value || ''
      result.email = emailEntry?.value || ''
    }

    // Notes from contactnote_set
    if (data.contactnote_set && Array.isArray(data.contactnote_set)) {
      const noteTexts = data.contactnote_set
        .sort((a, b) => new Date(b.create_date).getTime() - new Date(a.create_date).getTime())
        .map(n => n.contents)
        .filter(Boolean)
      result.notes = noteTexts.join('\n')
    }

    // Follow-up from event_set
    if (data.event_set && Array.isArray(data.event_set)) {
      const upcoming = data.event_set
        .filter(e => new Date(e.datetime || e.date) > new Date())
        .sort((a, b) => new Date(a.datetime || a.date).getTime() - new Date(b.datetime || b.date).getTime())
      if (upcoming.length > 0) {
        result.followUpDate = upcoming[0].datetime || upcoming[0].date || ''
      }
    }

    log(`  Contact ${contactId} details: addr="${result.address}", city="${result.city}", state="${result.state}", zip="${result.zip}", phone="${result.phone}", followUp="${result.followUpDate}"`)
  } catch (err) {
    logError(`Failed to fetch contact ${contactId}`, err)
  }
  return result
}

/**
 * Fetch today's call recordings from Mojo.
 * Returns a map of contactId → recording URL.
 */
async function fetchTodayRecordings(sessionId) {
  const recordingMap = new Map() // contactId → { audio, duration, recordId }
  try {
    const today = new Date().toISOString().split('T')[0]
    const url = `${MOJO_BASE_URL}/v2/rest/reports/call-recording-report-data/?agents=%5B-1%5D&date_range=custom&from=${today}&to=${today}`
    const response = await fetch(url, {
      headers: mojoHeaders(sessionId),
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) {
      log(`Recording API returned ${response.status}`)
      return recordingMap
    }
    const data = await response.json()
    const recordings = data.recordings || []
    log(`Fetched ${recordings.length} recordings for ${today}`)

    for (const rec of recordings) {
      const contactId = rec.contact?.id
      if (contactId && rec.audio) {
        // Keep longest recording per contact
        const existing = recordingMap.get(contactId)
        const durParts = (rec.duration || '0:00').split(':').map(Number)
        const durSec = durParts.length === 3
          ? durParts[0] * 3600 + durParts[1] * 60 + durParts[2]
          : durParts[0] * 60 + (durParts[1] || 0)

        if (!existing || durSec > existing.duration) {
          recordingMap.set(contactId, {
            audio: rec.audio,
            duration: durSec,
            recordId: rec.record_id,
          })
        }
      }
    }
  } catch (err) {
    logError('Failed to fetch recordings', err)
  }
  return recordingMap
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
async function buildCallRecords(activities, lastActivityId, sessionId, recordingMap, lastSyncTimestamp) {
  const lastSyncMs = new Date(lastSyncTimestamp || 0).getTime()

  const newActivities = activities
    .filter(a => {
      if (a[0] <= lastActivityId) return false
      // Also filter by timestamp — only process activities newer than last sync
      const [, , , timestamp] = a
      if (timestamp) {
        const activityMs = new Date(parseMojoTimestamp(timestamp)).getTime()
        if (activityMs <= lastSyncMs) return false
      }
      return true
    })
    .sort((a, b) => a[0] - b[0])

  if (newActivities.length === 0) return { calls: [], skippedCount: 0, maxId: lastActivityId, maxCallTimestamp: null }

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
        hasAppointment: false,
        followUpDate: '',
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
      case ACTIVITY_APPOINTMENT: {
        entry.hasAppointment = true
        entry.followUpDate = details.datetime || entry.followUpDate || ''
        log(`  Appointment set for ${entry.contactName}: ${entry.followUpDate || 'time missing'}`)
        break
      }
      case ACTIVITY_FOLLOWUP: {
        // Casey set a follow-up call — details.datetime is the scheduled time
        entry.followUpDate = details.datetime || ''
        log(`  Follow-up scheduled for ${entry.contactName}: ${entry.followUpDate}`)
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
    const isMeaningful = entry.isQualifiedLead || entry.hasAppointment || isMeaningfulGroup || isMeaningfulNotes

    if (!isMeaningful) {
      skippedCount++
      continue
    }

    // Map disposition
    let disposition = 'Interested'
    if (entry.hasAppointment || groupLower.includes('appointment')) disposition = 'Appointment Set'
    else if (groupLower.includes('follow up')) disposition = 'Callback Requested'

    // Clean notes — strip phone from first line
    let cleanNotes = entry.notes
    if (extractPhone(entry.notes)) {
      cleanNotes = entry.notes.replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim()
    }

    // Fetch full contact details from Mojo (address, phone, email)
    log(`  Fetching contact details for ${entry.contactName} (${contactId})...`)
    const contactDetails = await fetchContactDetails(sessionId, contactId)

    // Check for recording from today's recording report
    const recording = recordingMap?.get(Number(contactId))
    if (recording) {
      log(`  Found recording for ${entry.contactName}: ${recording.duration}s (record_id: ${recording.recordId})`)
    }

    // Use follow-up date from activity stream or contact details
    const followUpDate = entry.followUpDate || contactDetails.followUpDate || ''
    const canonicalActivityId = Math.max(...entry.activityIds)

    const call = {
      record_id: `mojo-activity-${contactId}-${canonicalActivityId}`,
      contact_name: entry.contactName,
      phone_number: entry.phone || contactDetails.phone,
      property_address: contactDetails.address,
      city: contactDetails.city,
      state: contactDetails.state,
      zip: contactDetails.zip,
      call_date: parseMojoTimestamp(entry.timestamp),
      call_duration: recording?.duration || 0,
      disposition,
      agent_name: entry.agentName,
      notes: cleanNotes || contactDetails.notes,
      list_name: '',
      campaign_name: '',
      recording_url: recording?.audio || '',
      follow_up_date: followUpDate,
      email: contactDetails.email,
    }

    calls.push(call)
  }

  const maxId = Math.max(...newActivities.map(a => a[0]), lastActivityId)

  // Track the newest call timestamp among meaningful calls processed
  let maxCallTimestamp = null
  if (calls.length > 0) {
    const timestamps = calls.map(c => new Date(c.call_date).getTime()).filter(t => !isNaN(t))
    if (timestamps.length > 0) {
      maxCallTimestamp = new Date(Math.max(...timestamps)).toISOString()
    }
  }

  return { calls, skippedCount, maxId, maxCallTimestamp }
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

    // Read delta timestamp from Supabase via CRM
    const lastSyncTimestamp = await readLastSyncTimestamp()
    log(`Last sync timestamp: ${lastSyncTimestamp}`)

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

    // Fetch today's recordings (for matching to contacts)
    log('Fetching today\'s call recordings...')
    const recordingMap = await fetchTodayRecordings(session.sessionId)

    // Build MEANINGFUL call records only (filtered by both activityId and timestamp)
    const { calls, skippedCount, maxId, maxCallTimestamp } = await buildCallRecords(activities, state.lastActivityId, session.sessionId, recordingMap, lastSyncTimestamp)
    log(`Built ${calls.length} meaningful calls, skipped ${skippedCount} non-meaningful`)

    if (calls.length === 0) {
      if (maxId > state.lastActivityId) {
        writeState({ lastActivityId: maxId, lastSync: new Date().toISOString() })
        log(`Updated state: lastActivityId=${maxId}`)
      }
      await processMojoQueue('no_new_calls')
      log(`No new calls since ${lastSyncTimestamp}`)
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
      headers: adminHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ calls }),
      signal: AbortSignal.timeout(120000),
    })

    if (!crmResponse.ok) {
      const errorText = await crmResponse.text()
      throw new Error(`CRM API returned ${crmResponse.status}: ${errorText}`)
    }

    const crmResult = await crmResponse.json()
    log(`CRM sync: queued=${crmResult.queued}, skipped=${crmResult.skipped}, total=${crmResult.total}`)
    await processMojoQueue('post_sync')

    // Update local state
    writeState({ lastActivityId: maxId, lastSync: new Date().toISOString() })
    log(`Updated state: lastActivityId=${maxId}`)

    // Update delta timestamp in Supabase
    const newTimestamp = maxCallTimestamp || new Date().toISOString()
    await writeLastSyncTimestamp(newTimestamp)

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
