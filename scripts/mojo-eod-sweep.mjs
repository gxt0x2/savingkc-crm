#!/usr/bin/env node
/**
 * Mojo EOD Sweep Script
 * Pulls ALL call activity for the current day from Mojo, posts to CRM.
 * The dedup queue in /api/mojo/sync handles duplicates -- no harm running this
 * after mojo-sync.mjs has already processed calls.
 *
 * Use case: end-of-day safety net to catch any calls missed by the delta poller
 * (e.g. if the poller had a session error or the machine was asleep).
 *
 * Differences from mojo-sync.mjs:
 *   - Ignores last_mojo_sync_timestamp -- always fetches today's full stream
 *   - Includes ALL dispositions (CRM dedup/meaningful filter applies downstream)
 *   - Updates last_mojo_sync_timestamp to now after successful post
 *
 * Run manually or schedule via cron at e.g. 5:30 PM M-F.
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// --- Load env from .env.local ---
function loadEnv() {
  const envPaths = [
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.env.local'),
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.env'),
  ]
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue
    const lines = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
    break
  }
}
loadEnv()

const MOJO_BASE_URL = 'https://app71.mojosells.com'
const CRM_API_URL = 'https://crm.savingkc.com/api/mojo/sync'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'
const LOG_DIR = '/Users/ernestdodson/.openclaw/workspace/memory/logs'
const LOG_FILE = path.join(LOG_DIR, 'mojo-eod-sweep.log')
const SYNC_TIMESTAMP_KEY = 'last_mojo_sync_timestamp'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

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

async function writeSyncTimestamp(isoTimestamp) {
  if (!supabase) return
  try {
    await supabase
      .from('system_config')
      .upsert({ key: SYNC_TIMESTAMP_KEY, value: isoTimestamp, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  } catch (err) {
    logError('Failed to write sync timestamp to Supabase', err)
  }
}

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
      throw new Error('session_expired')
    }
    throw new Error(`Mojo activity-stream returned ${resp.status}`)
  }

  const data = await resp.json()
  return data.activities || []
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

function extractPhone(noteContent) {
  if (!noteContent) return ''
  const firstLine = noteContent.match(/^(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/)
  if (firstLine) return firstLine[1].replace(/[-.\s]/g, '')
  const anywhere = noteContent.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/)
  if (anywhere) return anywhere[1].replace(/[-.\s]/g, '')
  return ''
}

const ACTIVITY_NOTE = 3
const ACTIVITY_FOLLOWUP = 6
const ACTIVITY_GROUP = 11
const ACTIVITY_LEAD = 30

/**
 * Build call records for ALL of today's activities.
 * No meaningful-only filter -- CRM dedup/filter handles that.
 */
function buildTodayCallRecords(activities) {
  const today = new Date().toISOString().split('T')[0]

  const todayActivities = activities.filter(a => {
    try {
      const iso = parseMojoTimestamp(a[3])
      return iso.startsWith(today)
    } catch {
      return false
    }
  })

  log(`Found ${todayActivities.length} activities for today (${today}) out of ${activities.length} total`)

  const contactMap = new Map()

  for (const activity of todayActivities) {
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
        followUpDate: '',
        address: details.address || '',
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
  for (const [contactId, entry] of contactMap) {
    const groupLower = entry.groupName.toLowerCase()
    let disposition = 'Interested'
    if (groupLower.includes('appointment')) disposition = 'Appointment Set'
    else if (groupLower.includes('follow up')) disposition = 'Callback Requested'
    else if (groupLower.includes('not interested')) disposition = 'Not Interested'
    else if (groupLower.includes('voicemail')) disposition = 'Voicemail Left'
    else if (groupLower.includes('no answer')) disposition = 'No Answer'
    else if (entry.isQualifiedLead) disposition = 'Qualified Lead'

    let cleanNotes = entry.notes
    if (extractPhone(entry.notes)) {
      cleanNotes = entry.notes.replace(/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\s*\n?/, '').trim()
    }

    calls.push({
      record_id: `mojo-activity-${contactId}-${entry.activityIds[0]}`,
      contact_name: entry.contactName,
      phone_number: entry.phone,
      property_address: entry.address,
      city: '',
      state: '',
      zip: '',
      call_date: parseMojoTimestamp(entry.timestamp),
      call_duration: 0,
      disposition,
      agent_name: entry.agentName,
      notes: cleanNotes,
      list_name: '',
      campaign_name: '',
      recording_url: '',
      follow_up_date: entry.followUpDate,
      email: '',
    })
  }

  return calls
}

async function sweep() {
  log('Starting Mojo EOD sweep (all of today)...')

  try {
    const session = readSession()
    if (!session?.sessionId) {
      log('No valid session found. Run session extraction first.')
      return { ok: false, error: 'no_session' }
    }

    log(`Using session: ${session.sessionId.substring(0, 20)}...`)

    // Fetch activity stream (pages 1 + 2 for full-day coverage)
    log('Fetching activity stream pages 1 and 2...')
    let activities = await fetchActivityStream(session.sessionId, 1)
    log(`Got ${activities.length} activities from page 1`)

    try {
      const page2 = await fetchActivityStream(session.sessionId, 2)
      if (page2.length > 0) {
        activities = [...activities, ...page2]
        log(`Total after page 2: ${activities.length}`)
      }
    } catch (err) {
      logError('Page 2 fetch failed (non-fatal)', err)
    }

    const calls = buildTodayCallRecords(activities)
    log(`Built ${calls.length} call records for today`)

    if (calls.length === 0) {
      log('No calls today -- nothing to post')
      await writeSyncTimestamp(new Date().toISOString())
      return { ok: true, processed: 0 }
    }

    for (const c of calls) {
      log(`  -> ${c.contact_name} (${c.phone_number || 'no phone'}) -- ${c.disposition}`)
    }

    log(`Posting ${calls.length} calls to CRM...`)
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
    log(`CRM response: queued=${crmResult.queued}, skipped=${crmResult.skipped}`)

    // Update timestamp so next delta poll starts from now
    const nowIso = new Date().toISOString()
    await writeSyncTimestamp(nowIso)
    log(`Updated last_mojo_sync_timestamp to ${nowIso}`)

    return { ok: true, ...crmResult }
  } catch (err) {
    logError('EOD sweep failed', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

sweep()
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
