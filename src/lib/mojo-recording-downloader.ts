/**
 * Download Mojo/Twilio call recording to a temporary file.
 * Returns the local file path for transcription.
 */
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

export async function downloadRecording(url: string, recordId?: string): Promise<string> {
  if (!url) throw new Error('No recording URL provided')

  // Mojo recordings may need auth; Twilio recordings are accessible with .mp3 suffix
  let downloadUrl = url
  if (url.includes('twilio.com') && !url.endsWith('.mp3')) {
    downloadUrl = url + '.mp3'
  }

  const response = await fetch(downloadUrl, {
    headers: {
      'User-Agent': 'SavingKC-CRM/1.0',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download recording: ${response.status} ${response.statusText}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())

  // Save to temp directory
  const dir = join(tmpdir(), 'savingkc-recordings')
  await mkdir(dir, { recursive: true })

  const filename = `recording-${recordId || Date.now()}.mp3`
  const filePath = join(dir, filename)
  await writeFile(filePath, buffer)

  return filePath
}
