#!/usr/bin/env node
/**
 * Capture provider source before qualification, then deliver with per-record
 * receipts. Scheduled sync replays seven days for late evidence. Server cron
 * owns KPI snapshots; this runtime owns source intake and session refresh.
 */

import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MOJO_INGESTION_VERSION, collectMojoActivities, assertMojoReceipts, spoolMojoSource, readMojoSpool } from './mojo-ingestion-integrity.mjs'
import { homedir } from 'node:os'
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
import {
  centralDateString,
  centralMidnightIso,
  recordingTimestamp,
  indexMojoRecordings,
  matchMojoRecording,
  normalizeMojoDateTime,
  parseMojoTimestamp,
} from './mojo-call-evidence.mjs'
import {
  assessMojoCallQualification,
  mojoSellerIntelSignals,
} from '../src/lib/mojo-call-qualification.mjs'

loadMojoEnv()

const MOJO_BASE_URL = 'https://app71.mojosells.com'
const CRM_BASE_URL = (process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/$/, '')
const CRM_API_URL = process.env.CRM_API_URL || `${CRM_BASE_URL}/api/mojo/sync`
const CRM_CONFIG_URL = process.env.CRM_CONFIG_URL || `${CRM_BASE_URL}/api/admin/system-config`
const CRM_QUEUE_URL = process.env.CRM_QUEUE_URL || `${CRM_BASE_URL}/api/cron/process-mojo-queue`
const CRM_SOURCE_URL = `${CRM_BASE_URL}/api/admin/mojo-source-batches`
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || process.env.CRON_SECRET || process.env.DEPLOY_SECRET || ''
const SESSION_FILE = mojoSessionFile()
const STATE_FILE = process.env.MOJO_SYNC_STATE_FILE
  || path.join(homedir(), '.openclaw/workspace/memory/mojo-sync-state.json')
const LOG_DIR = process.env.MOJO_LOG_DIR
  || path.join(homedir(), '.openclaw/workspace/memory/logs')
const LOG_FILE = path.join(LOG_DIR, 'mojo-sync.log')
const SPOOL_DIR = process.env.MOJO_SOURCE_SPOOL_DIR || path.join(path.dirname(STATE_FILE), 'mojo-source-spool')

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
  } catch (error) {
    throw new Error('Mojo checkpoint is unreadable; refusing to reset it', { cause: error })
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 })
  const temporary = `${STATE_FILE}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, STATE_FILE)
}

// --- Delta timestamp management (stored in Supabase via CRM API) ---

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

async function processMojoQueue(reason = 'scheduled_sync') {
  try {
    const queueUrl = `${CRM_QUEUE_URL}${CRM_QUEUE_URL.includes('?') ? '&' : '?'}limit=1`
    const res = await fetch(queueUrl, {
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
  markLocalSessionExpired()
}

async function pushSessionToCRM(sessionId) {
  const response = await fetch(CRM_API_URL.replace('/mojo/sync', '/admin/mojo-session'), {
    method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sessionId }), signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Mojo session handoff failed (${response.status}); source retained`)
  log('Mojo session accepted by CRM')
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
      throw new Error(`Contact lookup returned ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('json')) {
      throw new Error('Contact lookup returned non-JSON')
    }

    const data = await readMojoJson(response, 'contact details')

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

    log(`  Contact ${contactId} details fetched: phone=${Boolean(result.phone)}, email=${Boolean(result.email)}, addressEvidence=${Boolean(result.address)}, followUp=${Boolean(result.followUpDate)}`)
  } catch (err) {
    throw new Error(`Contact ${contactId} lookup failed; source retained for retry`, { cause: err })
  }
  return result
}

/**
 * Fetch today's call recordings from Mojo.
 * Returns a map of contactId → recording URL.
 */
async function fetchRecordings(sessionId, from, to) {
  const url = `${MOJO_BASE_URL}/v2/rest/reports/call-recording-report-data/?agents=%5B-1%5D&date_range=custom&from=${from}&to=${to}`
  const response = await fetch(url, { headers: mojoHeaders(sessionId), signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Recording API returned ${response.status}; checkpoint retained`)
  const data = await readMojoJson(response, 'recordings')
  if (!Array.isArray(data.recordings)) throw new Error('Invalid recording response; checkpoint retained')
  // Archive the entire response; the provider has returned records outside its
  // requested range. Local date filtering controls which records can be matched.
  return data.recordings
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
  if (!Array.isArray(data.activities)) throw new Error('Invalid activity response; checkpoint retained')
  return data.activities
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
/**
 * Process activities into MEANINGFUL call records only.
 * Now fetches contact details (address, phone) from Mojo for each meaningful contact.
 */
export async function buildCallRecords(activities, lastActivityId, sessionId, recordingMap, lastSyncTimestamp, contactLoader = fetchContactDetails, continueOnError = false) {
  const lastSyncMs = new Date(lastSyncTimestamp || 0).getTime()

  const newActivities = activities
    .filter(a => {
      if (a[0] <= lastActivityId) return false
      // Also filter by timestamp — only process activities newer than last sync
      const [, , , timestamp] = a
      if (timestamp) {
        const activityMs = new Date(parseMojoTimestamp(timestamp)).getTime()
        if (activityMs < lastSyncMs) return false
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

    const groupKey = `${contactId}:${centralDateString(new Date(parseMojoTimestamp(timestamp)))}`
    if (!contactMap.has(groupKey)) {
      contactMap.set(groupKey, {
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
        hasDnc: false,
        followUpDate: '',
      })
    }

    const entry = contactMap.get(groupKey)
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
        log(`  Appointment evidence found for contact ${contactId}`)
        break
      }
      case ACTIVITY_FOLLOWUP: {
        // Casey set a follow-up call — details.datetime is the scheduled time
        entry.followUpDate = details.datetime || ''
        log(`  Follow-up evidence found for contact ${contactId}`)
        break
      }
      case ACTIVITY_GROUP: {
        entry.groupName = details.group_name || ''
        if (/^(dnc|do not call|do-not-call)$/i.test(entry.groupName.trim())) entry.hasDnc = true
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
  const errors = []

  for (const entry of contactMap.values()) {
    const contactId = entry.contactId
    try {
      const groupLower = entry.groupName.toLowerCase()

      // === MEANINGFUL CHECK ===
      const isMeaningfulGroup = MEANINGFUL_GROUPS.has(groupLower)
      const isMeaningfulNotes = mojoSellerIntelSignals(entry.notes).length > 0
      const hasScheduledFollowUp = Boolean(entry.followUpDate)
      const isMeaningful = entry.hasDnc || entry.isQualifiedLead || entry.hasAppointment || hasScheduledFollowUp || isMeaningfulGroup || isMeaningfulNotes

      if (!isMeaningful) {
        skippedCount++
        continue
      }

      // Map disposition
      let disposition = 'Interested'
      if (entry.hasDnc) disposition = 'Do Not Call'
      else if (entry.hasAppointment || groupLower.includes('appointment')) disposition = 'Appointment Set'
      else if (hasScheduledFollowUp || groupLower.includes('follow up')) disposition = 'Callback Requested'

      // Clean notes — strip phone from first line
      let cleanNotes = entry.notes
      if (extractPhone(entry.notes)) {
        cleanNotes = entry.notes.replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim()
      }

      // Fetch full contact details from Mojo (address, phone, email)
      log(`  Fetching contact details for provider contact ${contactId}...`)
      const contactDetails = await contactLoader(sessionId, contactId)

      const callAt = parseMojoTimestamp(entry.timestamp)
      // Match the nearest unused recording for this contact. A contact can have
      // multiple calls in one day, so longest-per-contact is not a safe identity.
      const recording = matchMojoRecording(recordingMap, contactId, callAt)
      if (recording) {
        log(`  Found recording for contact ${contactId}: ${recording.duration}s (record_id: ${recording.recordId})`)
      }

      // Use follow-up date from activity stream or contact details
      const rawFollowUpDate = entry.hasDnc ? '' : entry.followUpDate || ''
      let followUpDate = ''
      try {
        followUpDate = normalizeMojoDateTime(rawFollowUpDate)
      } catch (error) {
        throw new Error(`Invalid follow-up date for provider contact ${contactId}; source retained`, { cause: error })
      }
      const canonicalActivityId = Math.max(...entry.activityIds)

      const call = {
        // Keep the historical provider-activity identity stable. The recording
        // ID is supporting evidence and may arrive after the call event.
        record_id: `mojo-activity-${contactId}-${canonicalActivityId}`,
        contact_name: entry.contactName,
        phone_number: entry.phone || contactDetails.phone,
        property_address: contactDetails.address,
        city: contactDetails.city,
        state: contactDetails.state,
        zip: contactDetails.zip,
        call_date: recording?.callAt || callAt,
        call_duration: recording?.duration || 0,
        disposition,
        agent_name: entry.agentName,
        notes: cleanNotes,
        list_name: '',
        campaign_name: '',
        recording_url: recording?.audio || '',
        provider_contact_id: String(contactId),
        provider_recording_id: recording?.recordId || '',
        qualified_by_agent: entry.isQualifiedLead,
        has_appointment: entry.hasAppointment,
        follow_up_date: followUpDate,
        email: contactDetails.email,
      }

      const qualification = assessMojoCallQualification({
        ...call,
        outcome: disposition === 'Do Not Call' ? 'dnc' : disposition === 'Appointment Set'
          ? 'appointment_set'
          : disposition === 'Callback Requested'
            ? 'callback_scheduled'
            : 'meaningful_conversation',
      })
      call.promotion_eligible = qualification.eligible
      call.qualification_status = qualification.status
      call.qualification_reasons = qualification.reasons
      if (qualification.status === 'evidence_pending') {
        log(`  Persisting ${entry.contactName} for end-of-day evidence retry (${qualification.reasons.join(', ')})`)
      } else if (!qualification.eligible) {
        log(`  Recording provider evidence for ${entry.contactName} without CRM promotion (${qualification.reasons.join(', ')})`)
      }
      calls.push(call)
    } catch (error) {
      if (!continueOnError) throw error
      errors.push(`Contact ${contactId}: ${error instanceof Error ? error.message : String(error)}`)
    }
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

  return { calls, skippedCount, maxId, maxCallTimestamp, errors }
}

// --- Receipt-backed source intake and replay ---

async function sourceRequest(method, body, after) {
  const url = after ? `${CRM_SOURCE_URL}?after=${encodeURIComponent(after)}` : CRM_SOURCE_URL
  const response = await fetch(url, {
    method, headers: adminHeaders({ 'content-type': 'application/json' }),
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`Source archive ${method} failed (${response.status}); checkpoint retained`)
  return response.json()
}

export async function deliverMojoCalls(calls, fetchImpl = fetch) {
  const errors = []
  for (let offset = 0; offset < calls.length; offset += 100) {
    const chunk = calls.slice(offset, offset + 100)
    try {
      const response = await fetchImpl(CRM_API_URL, {
        method: 'POST', headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ calls: chunk }), signal: AbortSignal.timeout(120000),
      })
      if (!response.ok) throw new Error(`CRM intake failed (${response.status}); checkpoint retained`)
      assertMojoReceipts(chunk, await response.json())
    } catch (error) { errors.push(error) }
  }
  if (errors.length) throw errors[0]
}

async function projectSourceBatch(batch, sessionId, contactLoader = fetchContactDetails) {
  const archive = await sourceRequest('POST', { id: batch.id, payload: batch.payload })
  if (archive.accepted) {
    if (batch.filename) fs.unlinkSync(batch.filename)
    return
  }
  const { activities, recordings, since } = batch.payload
  const inRange = recordings.filter(recording => {
    const timestamp = recordingTimestamp(recording)
    return timestamp != null && timestamp >= Date.parse(since)
      && centralDateString(new Date(timestamp)) <= batch.payload.to
  })
  const { calls, skippedCount, errors } = await buildCallRecords(
    activities, 0, sessionId, indexMojoRecordings(inRange), since, contactLoader, true,
  )
  await deliverMojoCalls(calls)
  if (errors?.length) throw new Error(`${errors.length} contact projections failed; source retained. ${errors[0]}`)
  await sourceRequest('PATCH', { id: batch.id, recordIds: calls.map(call => call.record_id) })
  // A durable remote receipt exists before the local spool can be removed.
  if (batch.filename) fs.unlinkSync(batch.filename)
  log(`Source batch ${batch.id.slice(0, 12)} accepted: calls=${calls.length}, archivedNonCandidates=${skippedCount}, sourceRecordings=${recordings.length}`)
}

export async function sync(options = {}) {
  const targetDate = options.date || centralDateString()
  const historical = Boolean(options.date)
  const dryRun = Boolean(options.dryRun)
  log(`Starting Mojo source intake ${MOJO_INGESTION_VERSION}${dryRun ? ' (dry run)' : ''}`)
  try {
    const session = readSession()
    if (!session?.sessionId) throw new Error('session_expired: Mojo session missing')
    const state = readState()
    // Revisit seven Central calendar days every run for delayed evidence.
    const from = historical ? targetDate : new Date(Date.parse(`${targetDate}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10)
    const since = centralMidnightIso(from)
    const activities = await collectMojoActivities(
      page => fetchActivityStream(session.sessionId, page),
      { lastActivityId: historical ? 0 : state.lastActivityId, since },
    )
    const recordings = await fetchRecordings(session.sessionId, from, targetDate)
    const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runtime-manifest.json')
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null
    const payload = {
      runtime: manifest ? { revision: manifest.revision, contentDigest: manifest.contentDigest } : { revision: 'development' },
      version: MOJO_INGESTION_VERSION, since, to: targetDate,
      activities: activities.filter(row => centralDateString(new Date(parseMojoTimestamp(row[3]))) <= targetDate),
      recordings,
    }
    if (dryRun) {
      log(`Dry run: ${payload.activities.length} source activities and ${recordings.length} recording rows; no CRM writes or checkpoint changes`)
      return { ok: true, dryRun: true, activities: payload.activities.length, recordings: recordings.length }
    }
    const batch = spoolMojoSource(SPOOL_DIR, payload)
    await sourceRequest('POST', { id: batch.id, payload: batch.payload })
    await pushSessionToCRM(session.sessionId)
    // Capture new source before retrying old problems. A poison batch must not
    // prevent capture or the delivery of unrelated callbacks and opt-outs.
    const pending = new Map([[batch.id, batch]])
    for (const retained of readMojoSpool(SPOOL_DIR)) pending.set(retained.id, retained)
    let after
    for (let page = 0; page < 10; page++) {
      const remote = await sourceRequest('GET', undefined, after)
      for (const retained of remote.batches || []) if (!pending.has(retained.id)) pending.set(retained.id, retained)
      if (!remote.nextCursor) break
      after = remote.nextCursor
    }
    const failures = []
    const contacts = new Map()
    const contactLoader = (sessionId, contactId) => {
      if (!contacts.has(contactId)) contacts.set(contactId, fetchContactDetails(sessionId, contactId))
      return contacts.get(contactId)
    }
    for (const retained of pending.values()) {
      try { await projectSourceBatch(retained, session.sessionId, contactLoader) }
      catch (error) {
        failures.push(error)
        logError(`Retained batch ${retained.id.slice(0, 12)}`, error)
        await sourceRequest('PATCH', { id: retained.id, error: error instanceof Error ? error.message : String(error) }).catch(logError.bind(null, 'Could not record source failure'))
      }
    }
    if (failures.length) throw new Error(`${failures.length} source batches remain unaccepted; checkpoint retained`, { cause: failures[0] })
    if (!historical) {
      const maxId = Math.max(state.lastActivityId || 0, ...activities.map(row => row[0]))
      // Timestamp is an observation receipt, not a second filter that can drop
      // an activity with a newer ID but an older provider timestamp.
      await writeLastSyncTimestamp(new Date().toISOString())
      writeState({ lastActivityId: maxId, lastSync: new Date().toISOString(), version: MOJO_INGESTION_VERSION })
      await clearMojoSessionIssue('mojo-sync')
      await clearMojoSyncIssue('mojo-sync')
    }
    await processMojoQueue('accepted_source_batch')
    return { ok: true, batchId: batch.id }
  } catch (error) {
    logError('Sync failed', error)
    if (!dryRun && isMojoSessionError(error)) {
      await recordMojoSessionIssue({ source: 'mojo-sync', reason: 'session_expired', message: 'Mojo session expired - manual refresh required' })
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  sync().then(result => { process.exitCode = result.ok ? 0 : 1 })
    .catch(error => { logError('Unexpected error', error); process.exitCode = 1 })
}
