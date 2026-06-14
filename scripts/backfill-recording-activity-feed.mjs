#!/usr/bin/env node
/**
 * Backfill playable call recording rows into lead_activities.
 *
 * This is intentionally feed-focused: it does not re-transcribe calls or touch
 * lead scoring. It scans Twilio recordings, resolves each recording's call to a
 * CRM lead, and inserts a missing activity row with metadata.recordingUrl
 * pointing at the existing /api/recordings/:sid proxy.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = join(__dirname, '..')

for (const envFile of ['.env.local', '.env.production', '.env']) {
  const path = join(root, envFile)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
}

const envFileArg = process.argv.find((arg) => arg.startsWith('--env-file='))
if (envFileArg) {
  const path = envFileArg.split('=').slice(1).join('=')
  if (!existsSync(path)) {
    console.error(`Env file not found: ${path}`)
    process.exit(1)
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
}

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const daysArg = process.argv.find((arg) => arg.startsWith('--days='))
const minDurationArg = process.argv.find((arg) => arg.startsWith('--min-duration='))
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))
const targetNameArg = process.argv.find((arg) => arg.startsWith('--name='))

const days = daysArg ? Number(daysArg.split('=')[1]) : 45
const minDuration = minDurationArg ? Number(minDurationArg.split('=')[1]) : 5
const limit = limitArg ? Number(limitArg.split('=')[1]) : 1000
const targetName = targetNameArg?.split('=').slice(1).join('=').toLowerCase()

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TWILIO_ACCOUNT_SID',
]
const missing = required.filter((key) => !process.env[key])
if (!process.env.TWILIO_AUTH_TOKEN && (!process.env.TWILIO_API_KEY || !process.env.TWILIO_API_SECRET)) {
  missing.push('TWILIO_AUTH_TOKEN or TWILIO_API_KEY/TWILIO_API_SECRET')
}
if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}`)
  process.exit(1)
}

const supabaseRestBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`

async function supabaseRequest(path, { method = 'GET', params, body, prefer } = {}) {
  const url = new URL(`${supabaseRestBase}${path}`)
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  }
  if (body) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Supabase ${res.status} ${path}: ${await res.text()}`)
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function supabaseMaybeSingle(path, params) {
  const rows = await supabaseRequest(path, { params: { ...params, limit: 1 } })
  return Array.isArray(rows) ? rows[0] || null : rows
}

const twilioAuthUser = process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID
const twilioAuthPass = process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN
const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}`

async function twilioGet(path, params = {}) {
  const url = new URL(`${twilioBase}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const auth = Buffer.from(`${twilioAuthUser}:${twilioAuthPass}`).toString('base64')
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) throw new Error(`Twilio ${res.status} ${path}: ${await res.text()}`)
  return res.json()
}

function parseTwilioDate(value) {
  return value ? new Date(value) : null
}

async function listRecordings({ since, limit }) {
  const out = []
  let nextPageUri = null
  do {
    const page = nextPageUri
      ? await twilioGet(nextPageUri.replace(`/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}`, '').replace('.json', '.json'))
      : await twilioGet('/Recordings.json', {
          'DateCreated>': since.toISOString().slice(0, 10),
          PageSize: Math.min(1000, limit),
        })
    for (const recording of page.recordings || []) {
      out.push({
        sid: recording.sid,
        callSid: recording.call_sid,
        duration: recording.duration,
        status: recording.status,
        dateCreated: parseTwilioDate(recording.date_created),
      })
      if (out.length >= limit) break
    }
    nextPageUri = out.length < limit ? page.next_page_uri : null
  } while (nextPageUri)
  return out
}

async function fetchCall(callSid) {
  const call = await twilioGet(`/Calls/${callSid}.json`)
  return {
    sid: call.sid,
    from: call.from,
    to: call.to,
    direction: call.direction,
  }
}

async function listChildCalls(parentCallSid) {
  const page = await twilioGet('/Calls.json', { ParentCallSid: parentCallSid, PageSize: 10 })
  return (page.calls || []).map((call) => ({
    sid: call.sid,
    from: call.from,
    to: call.to,
    direction: call.direction,
  }))
}

function digitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function normalizePhoneCandidates(phone) {
  const digits = digitsOnly(phone)
  if (!digits) return []
  const ten = digits.length > 10 ? digits.slice(-10) : digits
  return [...new Set([
    phone,
    digits,
    ten,
    `+1${ten}`,
    `1${ten}`,
  ].filter(Boolean))]
}

function callDirection(call) {
  if (String(call.from || '').startsWith('client:')) return 'outbound'
  if (String(call.to || '').startsWith('client:')) return 'inbound'
  return 'inbound'
}

async function findLeadByPhone(phone) {
  const candidates = normalizePhoneCandidates(phone)
  for (const candidate of candidates) {
    const data = await supabaseMaybeSingle('/leads', {
      select: 'id,full_name,phone,source',
      phone: `eq.${candidate}`,
    })
    if (data?.id) return data
  }

  const ten = digitsOnly(phone).slice(-10)
  if (!ten) return null
  return supabaseMaybeSingle('/leads', {
    select: 'id,full_name,phone,source',
    phone: `ilike.*${ten}`,
  })
}

async function resolveLeadForCall(callSid) {
  const call = await fetchCall(callSid)
  const phones = []

  if (call.from && !String(call.from).startsWith('client:')) phones.push(call.from)
  if (call.to && !String(call.to).startsWith('client:')) phones.push(call.to)

  const children = await listChildCalls(callSid)
  for (const child of children) {
    if (child.to && !String(child.to).startsWith('client:')) phones.push(child.to)
    if (child.from && !String(child.from).startsWith('client:')) phones.push(child.from)
  }

  for (const phone of [...new Set(phones)]) {
    const lead = await findLeadByPhone(phone)
    if (lead) return { lead, call, matchedPhone: phone }
  }

  return { lead: null, call, matchedPhone: phones[0] || null }
}

async function activityExists(recordingSid) {
  return supabaseMaybeSingle('/lead_activities', {
    select: 'id,lead_id,activity_type',
    'metadata->>recordingSid': `eq.${recordingSid}`,
  })
}

async function insertRecordingActivity({ recording, lead, call, matchedPhone }) {
  const recordingSid = recording.sid
  const duration = Number(recording.duration || 0)
  const direction = callDirection(call)
  const recordingUrl = `/api/recordings/${recordingSid}`
  const sourceUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}`

  const row = {
    lead_id: lead.id,
    activity_type: 'call',
    description: 'Call recording available',
    agent: 'System',
    created_at: recording.dateCreated?.toISOString?.() || new Date().toISOString(),
    metadata: {
      callSid: recording.callSid,
      direction,
      duration,
      from: call.from || null,
      matchedPhone,
      recordingSid,
      recordingSourceUrl: sourceUrl,
      recordingStatus: recording.status || 'completed',
      recordingUrl,
      source: 'recording_activity_backfill',
      to: call.to || null,
    },
  }

  if (dryRun) return { inserted: false, row }

  await supabaseRequest('/lead_activities', {
    method: 'POST',
    body: row,
    prefer: 'return=minimal',
  })
  return { inserted: true, row }
}

const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
console.log(`Scanning Twilio recordings since ${since.toISOString()} (minDuration=${minDuration}s, limit=${limit}, dryRun=${dryRun})`)

const recordings = await listRecordings({ since, limit })
const eligible = recordings.filter((recording) => Number(recording.duration || 0) >= minDuration)
console.log(`Twilio recordings found: ${recordings.length}; eligible: ${eligible.length}`)

const stats = {
  inserted: 0,
  alreadyHadActivity: 0,
  noLead: 0,
  filteredByName: 0,
  failed: 0,
}

const touched = []

for (const recording of eligible) {
  try {
    const existing = await activityExists(recording.sid)
    if (existing) {
      stats.alreadyHadActivity += 1
      continue
    }

    const { lead, call, matchedPhone } = await resolveLeadForCall(recording.callSid)
    if (!lead) {
      stats.noLead += 1
      console.log(`NO LEAD  ${recording.sid} call=${recording.callSid} phone=${matchedPhone || 'unknown'} duration=${recording.duration}s`)
      continue
    }

    if (targetName && !String(lead.full_name || '').toLowerCase().includes(targetName)) {
      stats.filteredByName += 1
      continue
    }

    const result = await insertRecordingActivity({ recording, lead, call, matchedPhone })
    if (result.inserted || dryRun) stats.inserted += 1
    touched.push({ lead, recording, matchedPhone, dryRun })
    console.log(`${dryRun ? 'WOULD INSERT' : 'INSERTED'} ${recording.sid} lead="${lead.full_name || '(no name)'}" phone=${lead.phone || matchedPhone || 'unknown'} duration=${recording.duration}s date=${recording.dateCreated?.toISOString?.()}`)
  } catch (error) {
    stats.failed += 1
    console.error(`FAILED ${recording.sid}: ${error.message}`)
  }
}

console.log('\nSummary')
console.log(JSON.stringify(stats, null, 2))
if (touched.length) {
  console.log('\nLeads with recording rows backfilled:')
  for (const item of touched) {
    console.log(`- ${item.lead.full_name || '(no name)'} ${item.lead.id} recording=${item.recording.sid}`)
  }
}
