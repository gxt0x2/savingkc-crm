/**
 * Download Mojo/Twilio call recording to a temporary file.
 * Returns the local file path for transcription.
 *
 * Mojo recordings require a session cookie. Auth priority:
 * 1. MOJO_SESSION_ID env var
 * 2. Session file at MOJO_SESSION_FILE or default path
 * 3. Fresh login using MOJO_EMAIL + MOJO_PASSWORD env vars
 */
import { writeFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir, homedir } from 'os'

import { createClient } from '@supabase/supabase-js'

const MOJO_BASE = 'https://app71.mojosells.com'
const SESSION_FILE_PATHS = [
  join(homedir(), '.openclaw/workspace/memory/mojo-session.json'),
  '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json',
]

// In-memory session cache (survives across requests within same process)
let cachedSessionId: string | null = null

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** Try to get session from Supabase system_config table */
async function getSessionFromSupabase(): Promise<string | null> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'mojo_session_id')
      .single()
    if (data?.value && typeof data.value === 'string') {
      return data.value
    }
    // Also try JSONB value
    if (data?.value?.sessionId) {
      return data.value.sessionId
    }
  } catch {
    // Table might not exist yet
  }
  return null
}

/** Store session in Supabase for persistence across restarts */
async function saveSessionToSupabase(sessionId: string): Promise<void> {
  try {
    const supabase = getSupabase()
    await supabase
      .from('system_config')
      .upsert({
        key: 'mojo_session_id',
        value: sessionId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
  } catch {
    // Best-effort, ignore if table doesn't exist
  }
}

async function getMojoSessionId(): Promise<string | null> {
  // 1. In-memory cache
  if (cachedSessionId) return cachedSessionId

  // 2. Env var
  if (process.env.MOJO_SESSION_ID) {
    cachedSessionId = process.env.MOJO_SESSION_ID
    return cachedSessionId
  }

  // 3. Supabase (persists across deploys/restarts)
  const dbSession = await getSessionFromSupabase()
  if (dbSession) {
    cachedSessionId = dbSession
    console.log('Mojo session loaded from Supabase')
    return cachedSessionId
  }

  // 4. Session files on disk
  const customPath = process.env.MOJO_SESSION_FILE
  const paths = customPath ? [customPath, ...SESSION_FILE_PATHS] : SESSION_FILE_PATHS
  for (const filePath of paths) {
    try {
      const content = await readFile(filePath, 'utf8')
      const session = JSON.parse(content)
      if (!session.expired && session.sessionId) {
        cachedSessionId = session.sessionId
        console.log(`Mojo session loaded from ${filePath}`)
        // Also persist to Supabase for future use
        await saveSessionToSupabase(session.sessionId)
        return cachedSessionId
      }
    } catch {
      // file doesn't exist or is invalid, try next
    }
  }

  return null
}

/** Clear cached session (call on auth failure to force re-login) */
function clearSessionCache() {
  cachedSessionId = null
}

export async function downloadRecording(url: string, recordId?: string): Promise<string> {
  if (!url) throw new Error('No recording URL provided')

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  let downloadUrl = url

  if (url.includes('mojosells.com')) {
    // Mojo recordings require session cookie auth
    const sessionId = await getMojoSessionId()
    if (!sessionId) {
      throw new Error('Mojo session not available. Set MOJO_SESSION_ID env var, store in Supabase system_config, or run mojo-extract-session on production Mac.')
    }
    headers['cookie'] = `sessionid=${sessionId}`
    headers['referer'] = `${MOJO_BASE}/`
    headers['accept'] = 'audio/mpeg, audio/*, */*'
  } else if (url.includes('twilio.com') && !url.endsWith('.mp3')) {
    downloadUrl = url + '.mp3'
  }

  const response = await fetch(downloadUrl, {
    headers,
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download recording: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    const body = await response.text()
    if ((body.includes('login') || body.includes('Login')) && url.includes('mojosells.com')) {
      // Session expired — clear cache so next attempt will re-fetch
      clearSessionCache()
      throw new Error('Mojo session expired — run mojo-extract-session on production Mac to refresh.')
    }
    throw new Error(`Expected audio but got ${contentType}: ${body.slice(0, 200)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())

  if (buffer.length < 1000) {
    throw new Error(`Downloaded file too small (${buffer.length} bytes) — likely not a valid recording`)
  }

  // Save to temp directory
  const dir = join(tmpdir(), 'savingkc-recordings')
  await mkdir(dir, { recursive: true })

  const filename = `recording-${recordId || Date.now()}.mp3`
  const filePath = join(dir, filename)
  await writeFile(filePath, buffer)

  console.log(`Downloaded recording: ${filePath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)
  return filePath
}
