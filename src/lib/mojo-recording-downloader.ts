/**
 * Download Mojo/Twilio call recording to a temporary file.
 * Returns the local file path for transcription.
 *
 * Mojo recordings require a session cookie.
 * Set MOJO_SESSION_ID env var, or place session JSON at MOJO_SESSION_FILE.
 */
import { writeFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const DEFAULT_SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'

async function getMojoSessionId(): Promise<string | null> {
  // Env var takes precedence
  if (process.env.MOJO_SESSION_ID) return process.env.MOJO_SESSION_ID

  // Try session file
  const sessionFile = process.env.MOJO_SESSION_FILE || DEFAULT_SESSION_FILE
  try {
    const content = await readFile(sessionFile, 'utf8')
    const session = JSON.parse(content)
    if (session.expired) return null
    return session.sessionId || null
  } catch {
    return null
  }
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
      throw new Error('Mojo session not available. Set MOJO_SESSION_ID env var or run mojo-extract-session.')
    }
    headers['cookie'] = `sessionid=${sessionId}`
    headers['referer'] = 'https://app71.mojosells.com/'
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
    // Mojo returned a login page or error JSON instead of audio
    const body = await response.text()
    if (body.includes('login') || body.includes('Login')) {
      throw new Error('Mojo session expired — got login page instead of audio')
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
