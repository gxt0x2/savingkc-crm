#!/usr/bin/env node
/**
 * Mojo Sync Script v2
 * Pulls call activity from Mojo's activity-stream API, syncs to CRM manifests.
 * Runs every 15 minutes (8am-5pm M-F) via cron.
 *
 * v1 used call-recording-report-data (only returned recorded calls — always empty).
 * v2 uses home/activity-stream which captures all call notes, dispositions, and lead qualifications.
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
const ACTIVITY_NOTE = 3         // "created note on" — call notes with phone + outcome
const ACTIVITY_DIAL_SESSION = 8 // "ended dial session" — session summary stats
const ACTIVITY_GROUP = 11       // "assigned contact to group" — disposition
const ACTIVITY_LEAD = 30        // "qualified as lead" — lead qualification

// Mojo group → CRM disposition mapping
const GROUP_DISPOSITION = {
  'appointment set': { outcome: 'appointment_set', priority: 'hot', alertErnest: true },
  'follow up':       { outcome: 'callback_scheduled', priority: 'warm' },
  'not yet interested': { outcome: 'not_interested', priority: 'cold' },
  'dead lead':       { outcome: 'not_interested', priority: 'cold', isDead: true },
  'trash':           { outcome: 'dead', priority: 'cold', isDead: true },
}

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

// --- Parse activities into call records ---

/**
 * Extract phone number from the first line of Casey's notes.
 * Pattern: "816-547-6163\ncontact and hung up 04/06"
 */
function extractPhone(noteContent) {
  if (!noteContent) return ''
  const match = noteContent.match(/^(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/)
  return match ? match[1].replace(/[-.\s]/g, '') : ''
}

/**
 * Infer disposition from note content when no group assignment exists.
 */
function inferDisposition(noteContent) {
  if (!noteContent) return 'Unknown'
  const lower = noteContent.toLowerCase()

  // Meaningful conversation indicators (detailed notes with structured info)
  if (lower.includes('timeline:') || lower.includes('motivation:') ||
      lower.includes('price:') || lower.includes('condition:') ||
      lower.includes('wants to sell') || lower.includes('asking price') ||
      lower.includes('appointment') || lower.includes('follow up') ||
      lower.includes('callback')) {
    return 'Interested'
  }

  if (lower.includes('wrong number')) return 'Wrong Number'
  if (lower.includes('disconnected')) return 'Disconnected'
  if (lower.includes('do not call') || lower.includes('dnc')) return 'DNC Request'
  if (lower.includes('already sold') || lower.includes('sold')) return 'Already Sold'
  if (lower.includes('listed') || lower.includes('with agent') || lower.includes('realtor')) return 'Listed'
  if (lower.includes('not interested') || lower.includes('hung up')) return 'Not Interested'
  if (lower.includes('left message') || lower.includes('left vm') || lower.includes('voicemail')) return 'Voicemail'
  if (lower.includes('no contact') || lower.includes('no answer')) return 'No Answer'
  if (lower.includes('busy')) return 'Busy'

  // If there's substantial text (more than just phone + short note), it's likely meaningful
  const lines = noteContent.split('\n').filter(l => l.trim())
  if (lines.length > 2 && noteContent.length > 100) {
    return 'Interested'
  }

  return 'Contact Made'
}

/**
 * Parse the Mojo activity timestamp "04/06/2026 01:40 PM" into ISO string
 */
function parseMojoTimestamp(ts) {
  try {
    // "MM/DD/YYYY HH:MM AM/PM" → Date
    const [datePart, timePart, ampm] = ts.split(' ')
    const [month, day, year] = datePart.split('/')
    let [hours, minutes] = timePart.split(':').map(Number)
    if (ampm === 'PM' && hours !== 12) hours += 12
    if (ampm === 'AM' && hours === 12) hours = 0
    // Mojo times are in Central time
    const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`)
    return d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/**
 * Process raw activity entries into grouped call records per contact.
 * Returns MojoCallRecord-compatible objects.
 */
function buildCallRecords(activities, lastActivityId) {
  // Filter to only new activities (newer than last processed)
  const newActivities = activities
    .filter(a => a[0] > lastActivityId)
    .sort((a, b) => a[0] - b[0]) // oldest first

  if (newActivities.length === 0) return { calls: [], maxId: lastActivityId }

  // Group by contact_id
  const contactMap = new Map()

  for (const activity of newActivities) {
    const [activityId, type, agentName, timestamp, details] = activity
    const contactId = details?.contact_id
    if (!contactId) continue // skip dial-session summaries without contact

    if (!contactMap.has(contactId)) {
      contactMap.set(contactId, {
        contactId,
        contactName: details.contact_name || 'Unknown',
        agentName,
        timestamp,
        activityIds: [],
        phone: '',
        notes: '',
        disposition: '',
        groupName: '',
        isQualifiedLead: false,
      })
    }

    const entry = contactMap.get(contactId)
    entry.activityIds.push(activityId)

    // Use the most recent timestamp
    if (activityId > Math.max(...entry.activityIds.slice(0, -1), 0)) {
      entry.timestamp = timestamp
    }

    switch (type) {
      case ACTIVITY_NOTE: {
        const content = details.contents || ''
        // Extract phone from first line if we don't have one
        if (!entry.phone) {
          entry.phone = extractPhone(content)
        }
        // Append notes (keep the most detailed one)
        if (content.length > entry.notes.length) {
          entry.notes = content
        }
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

  // Convert grouped entries to MojoCallRecord format
  const calls = []
  for (const [contactId, entry] of contactMap) {
    // Determine disposition: group assignment takes priority, then infer from notes
    let disposition = 'Unknown'
    if (entry.groupName) {
      // Use group name directly — the CRM's mapDisposition handles matching
      const groupLower = entry.groupName.toLowerCase()
      if (groupLower.includes('appointment')) disposition = 'Appointment Set'
      else if (groupLower.includes('follow up')) disposition = 'Callback Requested'
      else if (groupLower.includes('not yet interested')) disposition = 'Not Interested'
      else if (groupLower.includes('dead')) disposition = 'Not Interested'
      else if (groupLower.includes('trash')) disposition = 'Not Interested'
      else disposition = entry.groupName
    } else {
      disposition = inferDisposition(entry.notes)
    }

    // Strip phone number from notes (it's redundant — just the first line)
    let cleanNotes = entry.notes
    const phoneInNotes = extractPhone(entry.notes)
    if (phoneInNotes) {
      cleanNotes = entry.notes.replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim()
    }

    // If this was qualified as a lead AND has substantial notes, treat as meaningful
    if (entry.isQualifiedLead && disposition === 'Callback Requested') {
      // Keep as callback but ensure it gets flagged
    }
    if (entry.isQualifiedLead && disposition === 'Unknown') {
      disposition = 'Interested'
    }

    const call = {
      record_id: `mojo-activity-${contactId}-${entry.activityIds[0]}`,
      contact_name: entry.contactName,
      phone_number: entry.phone,
      property_address: '', // Not available from activity stream — CRM matches by phone
      city: '',
      state: '',
      zip: '',
      call_date: parseMojoTimestamp(entry.timestamp),
      call_duration: 0, // Not available from activity stream
      disposition,
      agent_name: entry.agentName,
      notes: cleanNotes,
      list_name: '',
      campaign_name: '',
      recording_url: '',
    }

    // Only include entries that have a phone OR are meaningful (qualified lead / group assigned)
    if (call.phone_number || entry.isQualifiedLead || entry.groupName) {
      calls.push(call)
    }
  }

  const maxId = Math.max(...newActivities.map(a => a[0]), lastActivityId)
  return { calls, maxId }
}

// --- Main sync ---

async function sync() {
  log('Starting Mojo sync (v2 — activity-stream)...')

  try {
    // Step 1: Session
    const session = readSession()
    if (!session?.sessionId) {
      log('No valid session found. Run session extraction first.')
      return { ok: false, error: 'no_session' }
    }

    log(`Using session: ${session.sessionId.substring(0, 20)}...`)
    await pushSessionToCRM(session.sessionId)

    // Step 2: Read last-processed state
    const state = readState()
    log(`Last processed activity ID: ${state.lastActivityId}`)

    // Step 3: Fetch activity stream (page 1 covers recent activity)
    log('Fetching activity stream page 1...')
    let activities = await fetchActivityStream(session.sessionId, 1)
    log(`Got ${activities.length} activities from page 1`)

    // If all activities are new (we might need page 2 for catch-up)
    if (activities.length > 0) {
      const oldestOnPage = Math.min(...activities.map(a => a[0]))
      if (oldestOnPage > state.lastActivityId && state.lastActivityId > 0) {
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

    // Step 4: Build call records from new activities
    const { calls, maxId } = buildCallRecords(activities, state.lastActivityId)
    log(`Built ${calls.length} call records from new activities`)

    if (calls.length === 0) {
      // Still update state even if no calls — so we track position
      if (maxId > state.lastActivityId) {
        writeState({ lastActivityId: maxId, lastSync: new Date().toISOString() })
        log(`Updated state: lastActivityId=${maxId} (no calls to sync)`)
      }
      log('No new calls to sync')
      return { ok: true, processed: 0 }
    }

    // Log meaningful conversations for visibility
    const meaningful = calls.filter(c =>
      ['Interested', 'Appointment Set', 'Callback Requested'].includes(c.disposition) ||
      c.notes.length > 100
    )
    if (meaningful.length > 0) {
      log(`🔥 ${meaningful.length} meaningful conversation(s):`)
      for (const c of meaningful) {
        log(`   → ${c.contact_name} (${c.phone_number || 'no phone'}) — ${c.disposition}`)
      }
    }

    // Step 5: POST to CRM
    log(`Posting ${calls.length} calls to CRM...`)
    const crmResponse = await fetch(CRM_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calls }),
      signal: AbortSignal.timeout(120000), // 2 min — Phase 2 intelligence takes time
    })

    if (!crmResponse.ok) {
      const errorText = await crmResponse.text()
      throw new Error(`CRM API returned ${crmResponse.status}: ${errorText}`)
    }

    const crmResult = await crmResponse.json()
    log(`CRM sync: processed=${crmResult.processed}, created=${crmResult.created}, updated=${crmResult.updated}, skipped=${crmResult.skipped}, alerts=${crmResult.alerts_sent}`)

    // Step 6: Update state
    writeState({ lastActivityId: maxId, lastSync: new Date().toISOString() })
    log(`Updated state: lastActivityId=${maxId}`)

    return { ok: true, ...crmResult }
  } catch (err) {
    logError('Sync failed', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Run
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
