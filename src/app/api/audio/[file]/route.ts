import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

const ALLOWED = new Set(['ivr-greeting.mp3', 'ivr-press1.mp3', 'ivr-no-answer.mp3', 'ivr-voicemail.mp3', 'us-ringback.wav'])

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  if (!ALLOWED.has(file)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const filePath = path.join(process.cwd(), 'public', 'audio', file)
  const buffer = await readFile(filePath)
  const contentType = file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
