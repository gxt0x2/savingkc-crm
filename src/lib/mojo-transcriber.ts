/**
 * Transcribe audio file to text using Groq Whisper API.
 * Groq provides fast, free whisper-large-v3-turbo transcription.
 */
import { readFile } from 'fs/promises'

export async function transcribeAudio(filePath: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured — needed for Whisper transcription')
  }

  const audioBuffer = await readFile(filePath)
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
