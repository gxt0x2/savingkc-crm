#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const INCIDENT_ID = 'crm_downtime_2026_07_06'
const DEFAULT_ENV_FILE = '.env.local'

const SMS_SIDS = [
  'SMad9ca5692f805851c120f79fa555a003',
  'SM219713325a472b98ce78ae56fc3bcdaf',
  'SM1bff2f132f2d0567f927f8a51c568e26',
]

const STRICT_CALL_SIDS = [
  'CAe0a7ad9cf6b1ddf731e3ed3fb70719b4',
  'CAa0e698d70a9e40072ab1d96c238e6e57',
  'CA419a2e2a8fa0bbd222d8849f76ef8c75',
  'CA1d003a9984e681d195988b44617ba95d',
]

const UNCERTAINTY_BUFFER_CALL_SIDS = [
  'CA8baaa74475920ceeeecb81ca290f9911',
]

const KNOWN_MATCHED_CALL_SIDS = [
  'CAd3f48287f866e044ed1e008541337df0',
]

const ACTIVITY_MESSAGE_KEYS = ['message_sid', 'MessageSid', 'sid', 'twilio_sid']
const ACTIVITY_CALL_KEYS = ['callSid', 'CallSid', 'dialCallSid', 'DialCallSid', 'parentCallSid']

function parseArgs(argv) {
  const args = {
    apply: false,
    confirmProductionWrite: false,
    includeUncertaintyBuffer: false,
    includeKnownMatchedCheck: true,
    envFile: DEFAULT_ENV_FILE,
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--confirm-production-write') args.confirmProductionWrite = true
    else if (arg === '--include-uncertainty-buffer') args.includeUncertaintyBuffer = true
    else if (arg === '--skip-known-matched-check') args.includeKnownMatchedCheck = false
    else if (arg === '--json') args.json = true
    else if (arg === '--env-file') {
      args.envFile = argv[index + 1]
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (args.apply && !args.confirmProductionWrite) {
    throw new Error('Refusing production writes. Re-run with --apply --confirm-production-write after reviewing dry-run output.')
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/reconcile-crm-downtime-backfill.mjs [options]

Options:
  --apply                         Write planned rows to production Supabase.
  --confirm-production-write       Required with --apply.
  --include-uncertainty-buffer     Include one optional buffer-window call.
  --skip-known-matched-check       Skip checking the already matched control SID.
  --env-file <path>                Env file to load. Defaults to .env.local.
  --json                           Print machine-readable JSON.

Default mode is dry-run. It performs no writes.`)
}

function loadEnv(filePath) {
  const absolute = resolve(process.cwd(), filePath)
  const content = readFileSync(absolute, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value.replace(/\\n/g, '').trim()
  }
}

function requireEnv(...keys) {
  for (const key of keys) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`)
  }
}

function createTwilioClient() {
  requireEnv('TWILIO_ACCOUNT_SID')
  if (process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET) {
    return twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
    })
  }
  requireEnv('TWILIO_AUTH_TOKEN')
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
}

function createSupabaseClient() {
  requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false },
  })
}

function phoneLast4(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits ? `***${digits.slice(-4)}` : null
}

function normalizePhone(phone) {
  if (!phone) return null
  const value = String(phone).trim()
  if (value.startsWith('+')) return value
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return value
}

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstName(fullName) {
  const raw = text(fullName)
  if (!raw) return null
  if (raw.includes(',')) {
    const [, rest] = raw.split(',', 2)
    return text(rest)?.split(/\s+/)[0] || null
  }
  return raw.split(/\s+/)[0] || null
}

function rankProspects(rows) {
  return [...rows].sort((a, b) => {
    const aOwner = a.relationship === 'owner' || a.relationship === 'subject' ? 0 : 1
    const bOwner = b.relationship === 'owner' || b.relationship === 'subject' ? 0 : 1
    if (aOwner !== bOwner) return aOwner - bOwner
    const aCat = a.prospects?.delinquent_years_category === '3yr_plus' ? 0 : 1
    const bCat = b.prospects?.delinquent_years_category === '3yr_plus' ? 0 : 1
    if (aCat !== bCat) return aCat - bCat
    return Number(b.prospects?.cumulative_due || 0) - Number(a.prospects?.cumulative_due || 0)
  })
}

async function findActivityByMetadata(db, keys, value) {
  for (const key of keys) {
    const { data, error } = await db
      .from('lead_activities')
      .select('id, lead_id, created_at, activity_type, metadata')
      .eq(`metadata->>${key}`, value)
      .limit(1)
    if (error) throw new Error(`lead_activities lookup failed for ${key}: ${error.message}`)
    if (data?.[0]) return data[0]
  }
  return null
}

async function findLeadByPhone(db, phone) {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  const { data, error } = await db
    .from('leads')
    .select('id, full_name, phone, source, station, priority, created_at, property_address, city, state, zip, county')
    .eq('phone', normalized)
    .limit(1)
  if (error) throw new Error(`leads lookup failed for ${phoneLast4(phone)}: ${error.message}`)
  return data?.[0] || null
}

async function findProspectsByPhone(db, phone) {
  const normalized = normalizePhone(phone)
  if (!normalized) return []
  const { data, error } = await db
    .from('prospect_phones')
    .select(`
      phone,
      phone_type,
      contact_name,
      relationship,
      prospects (
        id,
        owner_1,
        owner_1_first,
        owner_1_last,
        county,
        situs_address,
        situs_street,
        situs_city,
        situs_state,
        situs_zip,
        cumulative_due,
        delinquent_years_category,
        total_market_value,
        zestimate,
        is_deceased,
        lead_id
      )
    `)
    .eq('phone', normalized)
    .limit(10)
  if (error) throw new Error(`prospect lookup failed for ${phoneLast4(phone)}: ${error.message}`)
  return rankProspects((data || []).filter((row) => row.prospects))
}

function prospectSummary(row) {
  if (!row?.prospects) return null
  return {
    prospect_id: row.prospects.id,
    owner: row.prospects.owner_1,
    county: row.prospects.county,
    category: row.prospects.delinquent_years_category,
    cumulative_due: row.prospects.cumulative_due,
    lead_id: row.prospects.lead_id,
    relationship: row.relationship,
    phone_type: row.phone_type,
    contact_name: row.contact_name,
  }
}

function leadInsertFromProspect(prospectRow, phone, source, priority) {
  const prospect = prospectRow.prospects
  const name = text(prospect.owner_1) || text(prospectRow.contact_name) || `Inbound Lead (${phoneLast4(phone)})`
  return {
    full_name: name,
    phone: normalizePhone(phone),
    source,
    station: 'new',
    priority,
    property_address: text(prospect.situs_street) || text(prospect.situs_address),
    city: text(prospect.situs_city),
    state: text(prospect.situs_state),
    zip: text(prospect.situs_zip),
    county: text(prospect.county),
    parcel_id: text(prospect.parcel_id),
    assessed_value: prospect.total_market_value || null,
    back_taxes: prospect.cumulative_due || null,
    notes: `[${INCIDENT_ID}] Backfilled from Twilio provider event. Matched prospect ${prospect.id}.`,
  }
}

function genericLeadInsert(phone, source, priority, label) {
  return {
    full_name: `${label} (${phoneLast4(phone) || 'unknown'})`,
    phone: normalizePhone(phone),
    source,
    station: 'new',
    priority,
    notes: `[${INCIDENT_ID}] Backfilled from Twilio provider event. No prospect match found.`,
  }
}

function leadKeyForInsert(insert, prospectId = null) {
  if (prospectId) return `prospect:${prospectId}`
  return `phone:${normalizePhone(insert.phone) || 'unknown'}`
}

function buildSmsActivity(message, leadId, leadName) {
  const body = text(message.body) || ''
  const dateSent = iso(message.dateSent) || new Date().toISOString()
  return {
    lead_id: leadId,
    activity_type: 'sms',
    description: body,
    agent: 'system',
    created_at: dateSent,
    metadata: {
      direction: 'received',
      from: normalizePhone(message.from),
      to: normalizePhone(message.to),
      message_sid: message.sid,
      lead_name: leadName || 'Unknown',
      backfill: true,
      backfill_incident: INCIDENT_ID,
      original_date_sent: dateSent,
      provider_status: message.status,
      num_segments: message.numSegments,
    },
  }
}

function buildCallActivity(call, leadId, leadName) {
  const startTime = iso(call.startTime) || new Date().toISOString()
  return {
    lead_id: leadId,
    activity_type: 'call',
    description: `Inbound call from ${leadName || phoneLast4(call.from) || 'unknown'} - ${call.status} (${call.duration || 0}s)`,
    agent: 'System',
    created_at: startTime,
    metadata: {
      direction: 'inbound',
      from: normalizePhone(call.from),
      to: normalizePhone(call.to),
      callSid: call.sid,
      callStatus: call.status,
      duration: Number(call.duration || 0),
      matched_lead: Boolean(leadId),
      lead_name: leadName || null,
      backfill: true,
      backfill_incident: INCIDENT_ID,
      original_start_time: startTime,
    },
  }
}

function buildCallbackTask(call, leadId, leadName) {
  const startTime = iso(call.startTime) || new Date().toISOString()
  return {
    lead_id: leadId,
    activity_type: 'task',
    description: `Backfill review: missed inbound call from ${leadName || phoneLast4(call.from) || 'unknown'}`,
    agent: 'Ari',
    created_at: new Date().toISOString(),
    metadata: {
      task_type: 'callback',
      due_date: new Date().toISOString(),
      assigned_to: 'Casey',
      priority: 'high',
      status: 'pending',
      seller_phone: normalizePhone(call.from),
      callSid: call.sid,
      backfill: true,
      backfill_incident: INCIDENT_ID,
      original_start_time: startTime,
    },
  }
}

async function buildSmsPlan(db, client, sid) {
  const existingActivity = await findActivityByMetadata(db, ACTIVITY_MESSAGE_KEYS, sid)
  const message = await client.messages(sid).fetch()
  const from = normalizePhone(message.from)
  const lead = await findLeadByPhone(db, from)
  const prospects = lead ? [] : await findProspectsByPhone(db, from)
  const bestProspect = prospects[0] || null

  const plan = {
    kind: 'sms',
    sid,
    time: iso(message.dateSent),
    from_redacted: phoneLast4(message.from),
    to_redacted: phoneLast4(message.to),
    status: message.status,
    direction: message.direction,
    existing_activity_id: existingActivity?.id || null,
    matched_lead_id: lead?.id || null,
    matched_lead_name: lead?.full_name || null,
    prospect_matches: prospects.map(prospectSummary).filter(Boolean),
    operations: [],
  }

  if (existingActivity) {
    plan.operations.push({ action: 'skip_existing_activity', activity_id: existingActivity.id })
    return plan
  }

  let leadId = lead?.id || null
  let leadName = lead?.full_name || null
  if (!leadId) {
    if (bestProspect?.prospects?.lead_id) {
      leadId = bestProspect.prospects.lead_id
      leadName = bestProspect.prospects.owner_1 || bestProspect.contact_name
      plan.operations.push({
        action: 'link_existing_prospect_lead',
        lead_id: leadId,
        prospect_id: bestProspect.prospects.id,
      })
    } else if (bestProspect) {
      const insert = leadInsertFromProspect(bestProspect, from, 'tax_delinquent_inbound_sms', 'warm')
      plan.operations.push({
        action: 'create_lead_from_prospect',
        prospect_id: bestProspect.prospects.id,
        lead_key: leadKeyForInsert(insert, bestProspect.prospects.id),
        insert,
      })
      plan.operations.push({
        action: 'link_prospect_to_lead',
        prospect_id: bestProspect.prospects.id,
        lead_key: leadKeyForInsert(insert, bestProspect.prospects.id),
      })
      leadName = insert.full_name
    } else {
      const insert = genericLeadInsert(from, 'inbound_sms', 'warm', 'SMS Lead')
      plan.operations.push({ action: 'create_generic_lead', lead_key: leadKeyForInsert(insert), insert })
      leadName = insert.full_name
    }
  }

  plan.operations.push({
    action: 'insert_inbound_sms_activity',
    insert: buildSmsActivity(message, leadId, leadName),
  })
  return plan
}

async function buildCallPlan(db, client, sid, bucket) {
  const existingActivity = await findActivityByMetadata(db, ACTIVITY_CALL_KEYS, sid)
  const call = await client.calls(sid).fetch()
  const from = normalizePhone(call.from)
  const lead = await findLeadByPhone(db, from)
  const prospects = lead ? [] : await findProspectsByPhone(db, from)
  const bestProspect = prospects[0] || null

  const plan = {
    kind: 'call',
    sid,
    bucket,
    time: iso(call.startTime),
    from_redacted: phoneLast4(call.from),
    to_redacted: phoneLast4(call.to),
    status: call.status,
    direction: call.direction,
    duration: Number(call.duration || 0),
    existing_activity_id: existingActivity?.id || null,
    matched_lead_id: lead?.id || null,
    matched_lead_name: lead?.full_name || null,
    prospect_matches: prospects.map(prospectSummary).filter(Boolean),
    operations: [],
  }

  if (existingActivity) {
    plan.operations.push({ action: 'skip_existing_activity', activity_id: existingActivity.id })
    return plan
  }

  let leadId = lead?.id || null
  let leadName = lead?.full_name || null
  if (!leadId) {
    if (bestProspect?.prospects?.lead_id) {
      leadId = bestProspect.prospects.lead_id
      leadName = bestProspect.prospects.owner_1 || bestProspect.contact_name
      plan.operations.push({
        action: 'link_existing_prospect_lead',
        lead_id: leadId,
        prospect_id: bestProspect.prospects.id,
      })
    } else if (bestProspect) {
      const insert = leadInsertFromProspect(bestProspect, from, 'inbound_call', 'hot')
      plan.operations.push({
        action: 'create_lead_from_prospect',
        prospect_id: bestProspect.prospects.id,
        lead_key: leadKeyForInsert(insert, bestProspect.prospects.id),
        insert,
      })
      plan.operations.push({
        action: 'link_prospect_to_lead',
        prospect_id: bestProspect.prospects.id,
        lead_key: leadKeyForInsert(insert, bestProspect.prospects.id),
      })
      leadName = insert.full_name
    } else {
      const insert = genericLeadInsert(from, 'inbound_call', call.status === 'no-answer' ? 'hot' : 'warm', 'Inbound Call')
      plan.operations.push({ action: 'create_generic_lead', lead_key: leadKeyForInsert(insert), insert })
      leadName = insert.full_name
    }
  }

  plan.operations.push({
    action: 'insert_inbound_call_activity',
    insert: buildCallActivity(call, leadId, leadName),
  })

  if (call.status === 'no-answer' && leadId) {
    plan.operations.push({
      action: 'insert_callback_task',
      insert: buildCallbackTask(call, leadId, leadName),
      note: 'Review before applying if this stale callback task is no longer operationally useful.',
    })
  }

  return plan
}

function dedupePlannedLeadCreates(plans) {
  const planned = new Map()
  for (const plan of plans) {
    plan.operations = plan.operations.map((op) => {
      if (op.action !== 'create_lead_from_prospect' && op.action !== 'create_generic_lead') return op
      if (!op.lead_key) return op
      const existing = planned.get(op.lead_key)
      if (existing) {
        return {
          action: 'use_planned_lead',
          lead_key: op.lead_key,
          from_sid: existing.sid,
          original_action: op.action,
        }
      }
      planned.set(op.lead_key, { sid: plan.sid })
      return op
    })
    plan.operations = plan.operations.filter((op) => {
      if (op.action !== 'link_prospect_to_lead') return true
      const createsForKey = plan.operations.some((candidate) =>
        (candidate.action === 'create_lead_from_prospect' || candidate.action === 'create_generic_lead')
        && candidate.lead_key === op.lead_key
      )
      return createsForKey
    })
  }
}

async function applyPlan(db, plan, leadCache) {
  let leadId = plan.matched_lead_id || null
  const applied = []

  for (const op of plan.operations) {
    if (op.action === 'skip_existing_activity') {
      applied.push({ action: op.action, activity_id: op.activity_id })
      continue
    }

    if (op.action === 'link_existing_prospect_lead') {
      leadId = op.lead_id
      if (op.lead_key) leadCache.set(op.lead_key, leadId)
      applied.push({ action: op.action, lead_id: leadId, prospect_id: op.prospect_id })
      continue
    }

    if (op.action === 'use_planned_lead') {
      leadId = leadCache.get(op.lead_key) || leadId
      if (!leadId) throw new Error(`No planned lead available for ${plan.sid} (${op.lead_key})`)
      applied.push({ action: op.action, lead_id: leadId, from_sid: op.from_sid })
      continue
    }

    if (op.action === 'create_lead_from_prospect' || op.action === 'create_generic_lead') {
      const cachedLeadId = op.lead_key ? leadCache.get(op.lead_key) : null
      if (cachedLeadId) {
        leadId = cachedLeadId
        applied.push({ action: 'use_cached_lead', lead_id: leadId, lead_key: op.lead_key })
        continue
      }
      const existingLead = await findLeadByPhone(db, op.insert.phone)
      if (existingLead?.id) {
        leadId = existingLead.id
        if (op.lead_key) leadCache.set(op.lead_key, leadId)
        applied.push({ action: 'use_existing_lead_found_at_apply', lead_id: leadId, lead_key: op.lead_key })
        continue
      }
      const { data, error } = await db
        .from('leads')
        .insert(op.insert)
        .select('id, full_name')
        .single()
      if (error) throw new Error(`${op.action} failed for ${plan.sid}: ${error.message}`)
      leadId = data.id
      if (op.lead_key) leadCache.set(op.lead_key, leadId)
      applied.push({ action: op.action, lead_id: leadId, name: data.full_name || null })
      continue
    }

    if (op.action === 'link_prospect_to_lead') {
      leadId = leadCache.get(op.lead_key) || leadId
      if (!leadId) throw new Error(`No lead available to link prospect for ${plan.sid} (${op.prospect_id})`)
      const { error } = await db
        .from('prospects')
        .update({ lead_id: leadId })
        .eq('id', op.prospect_id)
        .is('lead_id', null)
      if (error) throw new Error(`link_prospect_to_lead failed for ${plan.sid}: ${error.message}`)
      applied.push({ action: op.action, lead_id: leadId, prospect_id: op.prospect_id })
      continue
    }

    if (op.action === 'insert_inbound_sms_activity' || op.action === 'insert_inbound_call_activity' || op.action === 'insert_callback_task') {
      const insert = {
        ...op.insert,
        lead_id: op.insert.lead_id || leadId,
      }
      const { data, error } = await db
        .from('lead_activities')
        .insert(insert)
        .select('id, lead_id')
        .single()
      if (error) throw new Error(`${op.action} failed for ${plan.sid}: ${error.message}`)
      applied.push({ action: op.action, activity_id: data.id, lead_id: data.lead_id })
      continue
    }

    throw new Error(`Unsupported operation ${op.action} for ${plan.sid}`)
  }

  return applied
}

function planWriteCount(plan) {
  return plan.operations.filter((op) =>
    !op.action.startsWith('skip_')
    && op.action !== 'link_existing_prospect_lead'
    && op.action !== 'use_planned_lead'
  ).length
}

function renderText(result) {
  console.log(`CRM downtime backfill reconciliation (${result.mode})`)
  console.log(`Incident: ${INCIDENT_ID}`)
  console.log(`Generated: ${result.generated_at}`)
  console.log(`Plans: ${result.summary.total_plans}, writes planned: ${result.summary.write_operations}`)
  console.log(`Existing/skipped controls: ${result.summary.skipped_existing}`)
  console.log('')

  for (const plan of result.plans) {
    console.log(`${plan.kind.toUpperCase()} ${plan.sid}`)
    console.log(`  time=${plan.time || 'unknown'} status=${plan.status || 'unknown'} from=${plan.from_redacted || 'unknown'} to=${plan.to_redacted || 'unknown'}`)
    if (plan.bucket) console.log(`  bucket=${plan.bucket}`)
    if (plan.existing_activity_id) console.log(`  existing_activity=${plan.existing_activity_id}`)
    if (plan.matched_lead_id) console.log(`  matched_lead=${plan.matched_lead_id} ${plan.matched_lead_name || ''}`.trim())
    if (plan.prospect_matches.length) {
      const first = plan.prospect_matches[0]
      console.log(`  prospect=${first.prospect_id} owner=${first.owner || 'unknown'} county=${first.county || 'unknown'} category=${first.category || 'unknown'}`)
    }
    for (const op of plan.operations) {
      const suffix = op.lead_id ? ` lead=${op.lead_id}` : op.prospect_id ? ` prospect=${op.prospect_id}` : op.activity_id ? ` activity=${op.activity_id}` : ''
      console.log(`  - ${op.action}${suffix}`)
      if (op.note) console.log(`    note=${op.note}`)
    }
    if (plan.applied?.length) {
      for (const item of plan.applied) {
        console.log(`    applied ${item.action}${item.lead_id ? ` lead=${item.lead_id}` : ''}${item.activity_id ? ` activity=${item.activity_id}` : ''}`)
      }
    }
    console.log('')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  loadEnv(args.envFile)
  const db = createSupabaseClient()
  const client = createTwilioClient()

  const plans = []
  for (const sid of SMS_SIDS) {
    plans.push(await buildSmsPlan(db, client, sid))
  }
  for (const sid of STRICT_CALL_SIDS) {
    plans.push(await buildCallPlan(db, client, sid, 'observed_outage'))
  }
  if (args.includeUncertaintyBuffer) {
    for (const sid of UNCERTAINTY_BUFFER_CALL_SIDS) {
      plans.push(await buildCallPlan(db, client, sid, 'uncertainty_buffer'))
    }
  }
  if (args.includeKnownMatchedCheck) {
    for (const sid of KNOWN_MATCHED_CALL_SIDS) {
      plans.push(await buildCallPlan(db, client, sid, 'known_matched_control'))
    }
  }
  dedupePlannedLeadCreates(plans)

  if (args.apply) {
    const leadCache = new Map()
    for (const plan of plans) {
      plan.applied = await applyPlan(db, plan, leadCache)
    }
  }

  const result = {
    generated_at: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry_run',
    include_uncertainty_buffer: args.includeUncertaintyBuffer,
    summary: {
      total_plans: plans.length,
      write_operations: plans.reduce((sum, plan) => sum + planWriteCount(plan), 0),
      skipped_existing: plans.filter((plan) => plan.operations.some((op) => op.action === 'skip_existing_activity')).length,
    },
    plans,
  }

  if (args.json) console.log(JSON.stringify(result, null, 2))
  else renderText(result)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
