/**
 * Transcribe audio file to text using Groq Whisper API.
 * Groq provides fast, free whisper-large-v3-turbo transcription.
 */
import { readFile, stat } from 'fs/promises'
const GROQ_AUDIO_UPLOAD_LIMIT_BYTES = 24 * 1024 * 1024

export async function transcribeAudio(filePath: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured — needed for Whisper transcription')
  }

  const uploadPath = await prepareAudioForGroq(filePath)
  const audioBuffer = await readFile(uploadPath)
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' })

  const formData = new FormData()
  formData.append('file', blob, 'recording.mp3')
  formData.append('model', 'whisper-large-v3-turbo')
  formData.append('language', 'en')
  formData.append('response_format', 'verbose_json')

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Groq Whisper API error: ${response.status} — ${errorText}`)
  }

  const result = await response.json()

  // verbose_json returns segments with timestamps — join into readable transcript
  if (result.segments && Array.isArray(result.segments)) {
    return result.segments
      .map((seg: any) => seg.text?.trim())
      .filter(Boolean)
      .join(' ')
  }

  return result.text || ''
}

async function prepareAudioForGroq(filePath: string): Promise<string> {
  const original = await stat(filePath)
  if (original.size <= GROQ_AUDIO_UPLOAD_LIMIT_BYTES) return filePath

  const compressedPath = compressedAudioPath(filePath)
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'

  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    await execFileAsync(ffmpeg, [
      '-y',
      '-i',
      filePath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '32k',
      compressedPath,
    ])
  } catch (error: any) {
    throw new Error(
      `Recording is ${(original.size / 1024 / 1024).toFixed(1)} MB, over Groq's upload limit, and ffmpeg compression is unavailable: ${error?.message || String(error)}`,
    )
  }

  const compressed = await stat(compressedPath)
  if (compressed.size > GROQ_AUDIO_UPLOAD_LIMIT_BYTES) {
    throw new Error(
      `Recording is still too large for Groq after compression (${(compressed.size / 1024 / 1024).toFixed(1)} MB)`,
    )
  }

  return compressedPath
}

function compressedAudioPath(filePath: string): string {
  return filePath.replace(/(\.[a-z0-9]+)?$/i, '.groq-compressed.mp3')
}
