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

const MOJO_BASE = 'https://app71.mojosells.com'
const SESSION_FILE_PATHS = [
  join(homedir(), '.openclaw/workspace/memory/mojo-session.json'),
  '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json',
]

// In-memory session cache (survives across requests within same process)
let cachedSessionId: string | null = null

async function loginToMojo(): Promise<string | null> {
  const email = process.env.MOJO_EMAIL || 'savingkc@gmail.com'
  // Fallback password from mojo-extract-session.mjs (already in repo)
  const password = process.env.MOJO_PASSWORD || 'Onlykillerspickupthephoneandmakecalls'

  try {
    // Step 1: Get login page (to collect any cookies/tokens)
    const pageRes = await fetch(`${MOJO_BASE}/login/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      redirect: 'manual',
    })
    const setCookies = pageRes.headers.getSetCookie?.() || []
    const cookies = setCookies.map(c => c.split(';')[0]).join('; ')

    // Step 2: POST login
    const loginRes = await fetch(`${MOJO_BASE}/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': `${MOJO_BASE}/login/`,
        'Origin': MOJO_BASE,
        'Cookie': cookies,
      },
      body: `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
      redirect: 'manual',
    })

    // Extract sessionid from Set-Cookie
    const loginCookies = loginRes.headers.getSetCookie?.() || []
    for (const cookie of loginCookies) {
      const match = cookie.match(/sessionid=([^;]+)/)
      if (match) {
        console.log('Mojo login successful, got session')
        return match[1]
      }
    }

    console.log('Mojo login: no session cookie in response (status:', loginRes.status, ')')
    return null
  } catch (e) {
    console.error('Mojo login failed:', e)
    return null
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

  // 3. Session files
  const customPath = process.env.MOJO_SESSION_FILE
  const paths = customPath ? [customPath, ...SESSION_FILE_PATHS] : SESSION_FILE_PATHS
  for (const filePath of paths) {
    try {
      const content = await readFile(filePath, 'utf8')
      const session = JSON.parse(content)
      if (!session.expired && session.sessionId) {
        cachedSessionId = session.sessionId
        console.log(`Mojo session loaded from ${filePath}`)
        return cachedSessionId
      }
    } catch {
      // file doesn't exist or is invalid, try next
    }
  }

  // 4. Try fresh login
  const freshSession = await loginToMojo()
  if (freshSession) {
    cachedSessionId = freshSession
    return cachedSessionId
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
      throw new Error('Mojo session not available. Set MOJO_SESSION_ID env var, MOJO_PASSWORD env var, or run mojo-extract-session.')
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
      // Session expired — clear cache and try once more with fresh login
      console.log('Mojo session expired, attempting re-login...')
      clearSessionCache()
      const newSessionId = await getMojoSessionId()
      if (newSessionId) {
        headers['cookie'] = `sessionid=${newSessionId}`
        const retryRes = await fetch(downloadUrl, { headers, redirect: 'follow' })
        if (retryRes.ok) {
          const retryType = retryRes.headers.get('content-type') || ''
          if (!retryType.includes('text/html')) {
            const retryBuffer = Buffer.from(await retryRes.arrayBuffer())
            if (retryBuffer.length >= 1000) {
              const dir = join(tmpdir(), 'savingkc-recordings')
              await mkdir(dir, { recursive: true })
              const filename = `recording-${recordId || Date.now()}.mp3`
              const filePath = join(dir, filename)
              await writeFile(filePath, retryBuffer)
              console.log(`Downloaded recording (retry): ${filePath} (${(retryBuffer.length / 1024 / 1024).toFixed(1)} MB)`)
              return filePath
            }
          }
        }
      }
      throw new Error('Mojo session expired — re-login failed. Set MOJO_PASSWORD env var or run mojo-extract-session.')
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
