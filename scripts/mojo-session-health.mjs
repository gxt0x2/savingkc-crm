import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.HOME || '/Users/ernestdodson'
const DEFAULT_SESSION_FILE = path.join(HOME, '.openclaw/workspace/memory/mojo-session.json')
const DEFAULT_ALERT_STATE_FILE = path.join(HOME, '.openclaw/workspace/memory/mojo-session-alert.json')
const DEFAULT_LOG_DIR = path.join(HOME, '.openclaw/workspace/memory/logs')

const ENV_CANDIDATES = [
  '.env.local',
  '.env.live',
  '.env',
  path.join(HOME, 'Documents/New project/savingkc-crm-fix/.env.live'),
  path.join(HOME, 'Documents/New project/savingkc-crm-fix/.env.local'),
  path.join(HOME, 'savingkc-crm/.env.live'),
  path.join(HOME, 'savingkc-crm/.env.local'),
]

function parseEnvLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const idx = trimmed.indexOf('=')
  if (idx === -1) return null

  const key = trimmed.slice(0, idx).trim()
  let value = trimmed.slice(idx + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return key ? [key, value] : null
}

export function loadMojoEnv(extraCandidates = []) {
  const candidates = [...extraCandidates, ...ENV_CANDIDATES]
  for (const candidate of candidates) {
    const envPath = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate)
    if (!fs.existsSync(envPath)) continue

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const parsed = parseEnvLine(line)
      if (!parsed) continue
      const [key, value] = parsed
      if (!process.env[key]) process.env[key] = value
    }
  }
}

export function mojoSessionFile() {
  return process.env.MOJO_SESSION_FILE || DEFAULT_SESSION_FILE
}

export function mojoAlertStateFile() {
  return process.env.MOJO_SESSION_ALERT_FILE || DEFAULT_ALERT_STATE_FILE
}

export function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

export function adminHeaders(base = {}) {
  const secret = cleanEnv('ADMIN_API_SECRET') || cleanEnv('CRON_SECRET') || cleanEnv('DEPLOY_SECRET')
  return secret ? { ...base, authorization: `Bearer ${secret}` } : base
}

export function crmBaseUrl() {
  return (process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/$/, '')
}

export async function writeSystemConfig(key, value) {
  const secret = cleanEnv('ADMIN_API_SECRET') || cleanEnv('CRON_SECRET') || cleanEnv('DEPLOY_SECRET')
  if (!secret) {
    console.log(`[mojo-session] Skipping system_config write for ${key}: no admin secret configured`)
    return false
  }

  try {
    const res = await fetch(`${crmBaseUrl()}/api/admin/system-config`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ key, value }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.log(`[mojo-session] system_config write failed for ${key}: ${res.status} ${text.slice(0, 160)}`)
      return false
    }

    return true
  } catch (err) {
    console.log(`[mojo-session] system_config write failed for ${key}: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export async function pushSessionToCrm(sessionId) {
  const secret = cleanEnv('ADMIN_API_SECRET') || cleanEnv('CRON_SECRET') || cleanEnv('DEPLOY_SECRET')
  if (!secret) {
    console.log('[mojo-session] Skipping CRM session push: no admin secret configured')
    return false
  }

  try {
    const res = await fetch(`${crmBaseUrl()}/api/admin/mojo-session`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.log(`[mojo-session] CRM session push failed: ${res.status} ${text.slice(0, 160)}`)
      return false
    }

    return true
  } catch (err) {
    console.log(`[mojo-session] CRM session push failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export function markLocalSessionExpired() {
  const filePath = mojoSessionFile()
  try {
    ensureParentDir(filePath)
    fs.writeFileSync(filePath, JSON.stringify({ expired: true, updatedAt: new Date().toISOString() }, null, 2))
  } catch (err) {
    console.log(`[mojo-session] Failed to mark local session expired: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function cleanEnv(name) {
  return process.env[name]
    ?.replace(/\\[rnt]/g, '')
    .replace(/\s+/g, '')
    .trim() ?? ''
}

function twilioAuth() {
  const accountSid = cleanEnv('TWILIO_ACCOUNT_SID')
  const apiKey = cleanEnv('TWILIO_API_KEY')
  const apiSecret = cleanEnv('TWILIO_API_SECRET')
  const authToken = cleanEnv('TWILIO_AUTH_TOKEN')

  if (accountSid && apiKey && apiSecret) {
    return { accountSid, username: apiKey, password: apiSecret }
  }

  if (accountSid && authToken) {
    return { accountSid, username: accountSid, password: authToken }
  }

  return null
}

function shouldThrottleAlert(now = Date.now()) {
  const filePath = mojoAlertStateFile()
  const minIntervalMs = Number(process.env.MOJO_SESSION_ALERT_MIN_INTERVAL_MINUTES || 360) * 60 * 1000
  try {
    if (!fs.existsSync(filePath)) return false
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const lastSentAt = new Date(state.lastSentAt || 0).getTime()
    return Number.isFinite(lastSentAt) && now - lastSentAt < minIntervalMs
  } catch {
    return false
  }
}

function writeAlertState(reason) {
  const filePath = mojoAlertStateFile()
  ensureParentDir(filePath)
  fs.writeFileSync(filePath, JSON.stringify({ lastSentAt: new Date().toISOString(), reason }, null, 2))
}

export async function sendMojoSessionSmsAlert(reason) {
  const auth = twilioAuth()
  const to = cleanEnv('MOJO_SESSION_ALERT_TO') || cleanEnv('ERNEST_PHONE')
  const from = cleanEnv('TWILIO_PHONE_NUMBER')
  const messagingServiceSid = cleanEnv('TWILIO_MESSAGING_SERVICE')

  if (!auth || !to || (!from && !messagingServiceSid)) {
    console.log('[mojo-session] SMS alert skipped: Twilio credentials, recipient, or sender not configured')
    return false
  }

  if (shouldThrottleAlert()) {
    console.log('[mojo-session] SMS alert throttled; prior Mojo session alert was sent recently')
    return false
  }

  const body = [
    'Mojo session expired - manual refresh required.',
    'Casey Mojo calls are not syncing to the CRM until refreshed.',
    `Reason: ${reason}.`,
    'Run: cd "/Users/ernestdodson/Documents/New project/savingkc-crm-fix" && npm run mojo:session:manual',
  ].join(' ')

  const params = new URLSearchParams({
    To: to,
    Body: body,
  })
  if (messagingServiceSid) params.set('MessagingServiceSid', messagingServiceSid)
  else params.set('From', from)

  const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.log(`[mojo-session] SMS alert failed: ${res.status} ${text.slice(0, 180)}`)
      return false
    }

    writeAlertState(reason)
    console.log('[mojo-session] SMS alert sent for Mojo session expiry')
    return true
  } catch (err) {
    console.log(`[mojo-session] SMS alert failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export async function insertBriefingEvent({ title, description, reason, source }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = cleanEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !supabaseKey) {
    console.log('[mojo-session] Briefing event skipped: Supabase env not configured')
    return false
  }

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    const { data: recent } = await supabase
      .from('ari_briefing_events')
      .select('id')
      .eq('event_type', 'system_failure')
      .contains('metadata', { system: 'mojo_session' })
      .gte('created_at', since)
      .limit(1)

    if (recent && recent.length > 0) return false

    const { error } = await supabase.from('ari_briefing_events').insert({
      event_type: 'system_failure',
      priority: 'critical',
      title,
      description,
      metadata: {
        system: 'mojo_session',
        reason,
        source,
        manual_refresh_command: 'npm run mojo:session:manual',
      },
      read: false,
      dismissed: false,
    })

    if (error) {
      console.log(`[mojo-session] Briefing event insert failed: ${error.message}`)
      return false
    }

    return true
  } catch (err) {
    console.log(`[mojo-session] Briefing event insert failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export async function recordMojoSessionIssue({ source, reason, message }) {
  const now = new Date().toISOString()
  const clearMessage = message || 'Mojo session expired - manual refresh required'
  console.error(`[mojo-session] ${clearMessage}`)

  markLocalSessionExpired()
  await writeSystemConfig('mojo_session_status', 'expired')
  await writeSystemConfig('mojo_session_last_error', clearMessage)
  await writeSystemConfig('mojo_session_last_error_at', now)
  await writeSystemConfig('mojo_sync_health', 'down')
  await insertBriefingEvent({
    title: 'System failure: Mojo session',
    description: `${clearMessage}. Casey Mojo calls will not sync to CRM until the session is refreshed.`,
    reason,
    source,
  })
  await sendMojoSessionSmsAlert(reason)
}

export async function clearMojoSessionIssue(source = 'mojo-session') {
  await writeSystemConfig('mojo_session_status', 'healthy')
  await writeSystemConfig('mojo_session_last_ok_at', new Date().toISOString())
  await writeSystemConfig('mojo_session_last_error', '')
  await writeSystemConfig('mojo_sync_health', 'healthy')
  const stateFile = mojoAlertStateFile()
  if (fs.existsSync(stateFile)) {
    try {
      fs.unlinkSync(stateFile)
    } catch {}
  }
  console.log(`[mojo-session] Session health cleared by ${source}`)
}

export function isMojoSessionError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /session_expired|login page|login redirect|manual refresh|required|no_session/i.test(message)
}

export function defaultLogDir() {
  return DEFAULT_LOG_DIR
}
