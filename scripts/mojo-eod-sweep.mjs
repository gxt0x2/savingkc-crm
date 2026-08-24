#!/usr/bin/env node
/**
 * Mojo EOD Sweep
 * Pulls ALL of Casey's calls for a target calendar day from the activity
 * stream and posts them to /api/mojo/sync. Runs at 5:30pm M-F via cron.
 *
 * Unlike the delta sync (mojo-sync.mjs), this ignores the last_mojo_sync_timestamp
 * and fetches everything since midnight today. Dedup is handled by the queue
 * table's unique constraint on record_id.
 *
 * After a successful same-day POST, updates last_mojo_sync_timestamp to now so
 * the next delta sync run starts clean. Historical --date backfills do not move
 * the live sync pointer.
 *
 * Crontab entry (Ernest adds manually):
 *   30 17 * * 1-5 cd "$CRM_REPO" && set -a && . ./.env.live && set +a && /usr/local/bin/node scripts/mojo-eod-sweep.mjs >> /tmp/mojo-eod-sweep.log 2>&1
 */

import fs from 'fs'
import path from 'path'
import {
  clearMojoSessionIssue,
  clearMojoSyncIssue,
  isMojoSessionError,
  loadMojoEnv,
  markLocalSessionExpired,
  mojoSessionFile,
  recordMojoSessionIssue,
} from './mojo-session-health.mjs'

loadMojoEnv()

const MOJO_BASE_URL = 'https://app71.mojosells.com'
const CRM_BASE_URL = (process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/$/, '')
const CRM_API_URL = process.env.CRM_API_URL || `${CRM_BASE_URL}/api/mojo/sync`
const CRM_CONFIG_URL = process.env.CRM_CONFIG_URL || `${CRM_BASE_URL}/api/admin/system-config`
const CRM_QUEUE_URL = process.env.CRM_QUEUE_URL || `${CRM_BASE_URL}/api/cron/process-mojo-queue`
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || process.env.CRON_SECRET || process.env.DEPLOY_SECRET || ''
const SESSION_FILE = mojoSessionFile()
const LOG_DIR = '/Users/ernestdodson/.openclaw/workspace/memory/logs'
const LOG_FILE = path.join(LOG_DIR, 'mojo-eod-sweep.log')

// Mojo activity type codes
const ACTIVITY_NOTE = 3
const ACTIVITY_APPOINTMENT = 5
const ACTIVITY_FOLLOWUP = 6
const ACTIVITY_GROUP = 11
const ACTIVITY_LEAD = 30

const MEANINGFUL_GROUPS = new Set(['follow up', 'appointment set'])

function getCliArg(flag, defaultValue = '') {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultValue
}

function centralDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0))
  return date.toISOString().slice(0, 10)
}

const REQUESTED_DATE = getCliArg('--date', process.env.MOJO_SWEEP_DATE || '')
if (REQUESTED_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(REQUESTED_DATE)) {
  throw new Error('--date must be in YYYY-MM-DD format')
}
const TARGET_DATE = REQUESTED_DATE || centralDateString()
const IS_HISTORICAL_SWEEP = Boolean(REQUESTED_DATE)
const DRY_RUN = process.argv.includes('--dry-run')

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

// --- Session ---

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
  markLocalSessionExpired()
}

// --- CRM config ---

async function writeLastSyncTimestamp(timestamp) {
  const res = await fetch(CRM_CONFIG_URL, {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key: 'last_mojo_sync_timestamp', value: timestamp }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Config write failed (${res.status})`)
  log(`Updated last_mojo_sync_timestamp to ${timestamp}`)
}

async function processMojoQueue(reason = 'eod_sweep') {
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
      log(`Queue processor: claimed=${result.claimed ?? 0}, completed=${result.completed ?? 0}, retrying=${result.pending ?? 0}, dead-letter=${result.deadLetter ?? 0}, failed=${result.failed ?? 0}`)
    }
  } catch (err) {
    logError(`Queue processor failed during ${reason}`, err)
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

function looksLikeLoginResponse(resp, bodyText = '') {
  const responseUrl = resp.url || ''
  const lowerBody = bodyText.toLowerCase()
  return (
    resp.redirected ||
    responseUrl.includes('/login') ||
    responseUrl.includes('/accounts/login') ||
    lowerBody.includes('<form') && lowerBody.includes('password') && lowerBody.includes('login')
  )
}

async function readMojoJson(resp, label) {
  if (resp.status === 401 || resp.status === 403 || (resp.status >= 300 && resp.status < 400)) {
    markSessionExpired()
    throw new Error(`session_expired: Mojo ${label} returned ${resp.status}`)
  }

  const contentType = resp.headers.get('content-type') || ''
  const bodyText = await resp.text()

  if (looksLikeLoginResponse(resp, bodyText)) {
    markSessionExpired()
    throw new Error(`session_expired: Mojo ${label} returned login page`)
  }

  if (!contentType.includes('json')) {
    throw new Error(`Mojo ${label} returned non-JSON (${contentType || 'unknown content type'})`)
  }

  return JSON.parse(bodyText)
}

async function fetchActivityStream(sessionId, page = 1) {
  const url = `${MOJO_BASE_URL}/v2/rest/home/activity-stream/?page=${page}`
  const resp = await fetch(url, {
    headers: mojoHeaders(sessionId),
    signal: AbortSignal.timeout(20000),
  })

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403 || (resp.status >= 300 && resp.status < 400)) {
      markSessionExpired()
      throw new Error(`session_expired: Mojo activity-stream returned ${resp.status}`)
    }
    throw new Error(`Mojo activity-stream returned ${resp.status}`)
  }

  const data = await readMojoJson(resp, 'activity-stream')
  return data.activities || []
}

async function fetchContactDetails(sessionId, contactId) {
  const result = { phone: '', notes: '', address: '', city: '', state: '', zip: '', email: '', followUpDate: '' }
  if (!contactId) return result
  try {
    const url = `${MOJO_BASE_URL}/v2/rest/contacts/data/${contactId}/`
    const response = await fetch(url, {
      headers: mojoHeaders(sessionId),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return result

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('json')) return result

    const data = await response.json()

    result.address = data.address || data.full_address || ''
    result.city = data.city || ''
    result.state = data.state || ''
    result.zip = data.zip_code || data.zip || ''

    if (data.mediainfo_set && Array.isArray(data.mediainfo_set)) {
      const primaryPhone = data.mediainfo_set.find(m => m.type === 3 && m.value)
      const anyPhone = data.mediainfo_set.find(m => (m.type === 2 || m.type === 3) && m.value)
      const emailEntry = data.mediainfo_set.find(m => m.type === 4 && m.value)
      result.phone = (primaryPhone || anyPhone)?.value || ''
      result.email = emailEntry?.value || ''
    }

    if (data.contactnote_set && Array.isArray(data.contactnote_set)) {
      const noteTexts = data.contactnote_set
        .sort((a, b) => new Date(b.create_date).getTime() - new Date(a.create_date).getTime())
        .map(n => n.contents)
        .filter(Boolean)
      result.notes = noteTexts.join('\n')
    }

    if (data.event_set && Array.isArray(data.event_set)) {
      const upcoming = data.event_set
        .filter(e => new Date(e.datetime || e.date) > new Date())
        .sort((a, b) => new Date(a.datetime || a.date).getTime() - new Date(b.datetime || b.date).getTime())
      if (upcoming.length > 0) {
        result.followUpDate = upcoming[0].datetime || upcoming[0].date || ''
      }
    }
  } catch (err) {
    logError(`Failed to fetch contact ${contactId}`, err)
  }
  return result
}

async function fetchRecordingsForDate(sessionId, targetDate) {
  const recordingMap = new Map()
  try {
    const url = `${MOJO_BASE_URL}/v2/rest/reports/call-recording-report-data/?agents=%5B-1%5D&date_range=custom&from=${targetDate}&to=${targetDate}`
    const response = await fetch(url, {
      headers: mojoHeaders(sessionId),
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) return recordingMap
    const data = await response.json()
    const recordings = data.recordings || []
    log(`Fetched ${recordings.length} recordings for ${targetDate}`)

    for (const rec of recordings) {
      const contactId = rec.contact?.id
      if (contactId && rec.audio) {
        const existing = recordingMap.get(contactId)
        const durParts = (rec.duration || '0:00').split(':').map(Number)
        const durSec = durParts.length === 3
          ? durParts[0] * 3600 + durParts[1] * 60 + durParts[2]
          : durParts[0] * 60 + (durParts[1] || 0)
        if (!existing || durSec > existing.duration) {
          recordingMap.set(contactId, { audio: rec.audio, duration: durSec, recordId: rec.record_id })
        }
      }
    }
  } catch (err) {
    logError('Failed to fetch recordings', err)
  }
  return recordingMap
}

// --- Parse helpers ---

function extractPhone(noteContent) {
  if (!noteContent) return ''
  const firstLine = noteContent.match(/^(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/)
  if (firstLine) return firstLine[1].replace(/[-.\s]/g, '')
  const anywhere = noteContent.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/)
  if (anywhere) return anywhere[1].replace(/[-.\s]/g, '')
  return ''
}

function hasSellerIntel(noteContent) {
  if (!noteContent) return false
  const lower = noteContent.toLowerCase()
  if (lower.includes('timeline:') || lower.includes('motivation:') ||
      lower.includes('price:') || lower.includes('condition:') ||
      lower.includes('asking price') || lower.includes('wants to sell') ||
      lower.includes('appointment set') || lower.includes('rent back') ||
      lower.includes('equity') || lower.includes('foreclosure') ||
      lower.includes('inherited') || lower.includes('probate')) {
    return true
  }
  const lines = noteContent.split('\n').filter(l => l.trim())
  const textLength = noteContent.replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim().length
  if (lines.length >= 3 && textLength > 80) return true
  return false
}

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
 * Get midnight (start) of a date in Central Time.
 */
function getDateMidnightISO(dateStr) {
  return new Date(`${dateStr}T00:00:00-05:00`).toISOString()
}

// --- Build call records for one day (no activityId or timestamp delta filter) ---

async function buildCallRecordsForDate(activities, sessionId, recordingMap, targetDate) {
  const startMs = new Date(getDateMidnightISO(targetDate)).getTime()
  const endMs = new Date(getDateMidnightISO(addDays(targetDate, 1))).getTime()

  // Filter to activities from today only
  const targetActivities = activities.filter(a => {
    const [, , , timestamp] = a
    if (!timestamp) return false
    const activityMs = new Date(parseMojoTimestamp(timestamp)).getTime()
    return activityMs >= startMs && activityMs < endMs
  })

  log(`Total activities: ${activities.length}, ${targetDate} activities: ${targetActivities.length}`)

  if (targetActivities.length === 0) return { calls: [], skippedCount: 0 }

  // Group by contact_id
  const contactMap = new Map()

  for (const activity of targetActivities) {
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
        break
      }
      case ACTIVITY_FOLLOWUP: {
        entry.followUpDate = details.datetime || ''
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

  const calls = []
  let skippedCount = 0

  for (const [contactId, entry] of contactMap) {
    const groupLower = entry.groupName.toLowerCase()
    const isMeaningfulGroup = MEANINGFUL_GROUPS.has(groupLower)
    const isMeaningfulNotes = hasSellerIntel(entry.notes)
    const isMeaningful = entry.isQualifiedLead || entry.hasAppointment || isMeaningfulGroup || isMeaningfulNotes

    if (!isMeaningful) {
      skippedCount++
      continue
    }

    let disposition = 'Interested'
    if (entry.hasAppointment || groupLower.includes('appointment')) disposition = 'Appointment Set'
    else if (groupLower.includes('follow up')) disposition = 'Callback Requested'

    let cleanNotes = entry.notes
    if (extractPhone(entry.notes)) {
      cleanNotes = entry.notes.replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim()
    }

    log(`  Fetching contact details for ${entry.contactName} (${contactId})...`)
    const contactDetails = await fetchContactDetails(sessionId, contactId)

    const recording = recordingMap?.get(Number(contactId))
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

  return { calls, skippedCount }
}

// --- Main EOD sweep ---

async function eodSweep() {
  log(`Starting Mojo EOD sweep for ${TARGET_DATE}${DRY_RUN ? ' (dry run)' : ''}...`)

  try {
    const session = readSession()
    if (!session?.sessionId) {
      const message = 'Mojo session expired - manual refresh required'
      log(message)
      await recordMojoSessionIssue({
        source: 'mojo-eod-sweep',
        reason: 'no_session',
        message,
      })
      return { ok: false, error: 'no_session' }
    }

    log('Using validated Mojo session')

    // Fetch activity stream — pull up to 5 pages to ensure full day coverage
    log('Fetching activity stream (up to 5 pages)...')
    let activities = []
    const targetMidnightMs = new Date(getDateMidnightISO(TARGET_DATE)).getTime()
    for (let page = 1; page <= 5; page++) {
      try {
        const pageActivities = await fetchActivityStream(session.sessionId, page)
        log(`Page ${page}: ${pageActivities.length} activities`)
        if (pageActivities.length === 0) break
        activities = [...activities, ...pageActivities]

        // Stop if we've gone past the target date.
        const oldestOnPage = pageActivities
          .map(a => new Date(parseMojoTimestamp(a[3])).getTime())
          .filter(t => !isNaN(t))
        if (oldestOnPage.length > 0 && Math.min(...oldestOnPage) < targetMidnightMs) {
          log(`Page ${page} contains activities from before ${TARGET_DATE} — stopping pagination`)
          break
        }
      } catch (err) {
        logError(`Page ${page} fetch failed (non-fatal)`, err)
        break
      }
    }
    log(`Total activities fetched: ${activities.length}`)

    // Fetch target date recordings
    log(`Fetching ${TARGET_DATE} call recordings...`)
    const recordingMap = await fetchRecordingsForDate(session.sessionId, TARGET_DATE)

    // Build call records for the target date (no delta filter)
    const { calls, skippedCount } = await buildCallRecordsForDate(activities, session.sessionId, recordingMap, TARGET_DATE)
    log(`Built ${calls.length} meaningful calls for ${TARGET_DATE}, skipped ${skippedCount} non-meaningful`)

    if (calls.length === 0) {
      log(`No meaningful calls found for ${TARGET_DATE}`)
      if (!IS_HISTORICAL_SWEEP && !DRY_RUN) {
        // Still update the timestamp so next delta sync starts from now.
        await writeLastSyncTimestamp(new Date().toISOString())
        await processMojoQueue('no_eod_calls')
        await clearMojoSessionIssue('mojo-eod-sweep')
        await clearMojoSyncIssue('mojo-eod-sweep')
      } else {
        log('Skipped last_mojo_sync_timestamp update for historical/dry run sweep')
      }
      return { ok: true, processed: 0 }
    }

    for (const c of calls) log(`  -> ${c.record_id} -- ${c.disposition}`)

    if (DRY_RUN) {
      log(`Dry run complete — would post ${calls.length} calls to CRM`)
      return { ok: true, dryRun: true, processed: calls.length }
    }

    // POST to CRM — queue dedup handles any already-processed records
    log(`Posting ${calls.length} calls to CRM...`)
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
    await processMojoQueue('post_eod_sweep')

    if (!IS_HISTORICAL_SWEEP) {
      // Update delta timestamp to now so next delta sync starts fresh.
      await writeLastSyncTimestamp(new Date().toISOString())
    } else {
      log('Skipped last_mojo_sync_timestamp update for historical sweep')
    }

    await clearMojoSessionIssue('mojo-eod-sweep')
    if (!IS_HISTORICAL_SWEEP) await clearMojoSyncIssue('mojo-eod-sweep')
    return { ok: true, ...crmResult }
  } catch (err) {
    logError('EOD sweep failed', err)
    if (isMojoSessionError(err)) {
      await recordMojoSessionIssue({
        source: 'mojo-eod-sweep',
        reason: 'session_expired',
        message: 'Mojo session expired - manual refresh required',
      })
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

eodSweep()
  .then((result) => {
    if (result.ok) {
      log('EOD sweep completed successfully')
      process.exit(0)
    } else {
      log(`EOD sweep failed: ${result.error}`)
      process.exit(1)
    }
  })
  .catch((err) => {
    logError('Unexpected error', err)
    process.exit(1)
  })
