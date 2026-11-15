import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { recordingStoragePath } from '@/lib/marketing/recording-playback'
import { streamStoredRecording } from '@/lib/server/recording-stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Stream a private recordings-bucket object through a short-lived signed URL. */
export async function GET(request: Request) {
  const unauthorized = await requireAuthenticatedUser()
  if (unauthorized) return unauthorized

  const path = recordingStoragePath(new URL(request.url).searchParams.get('path'))
  if (!path) return NextResponse.json({ error: 'Invalid recording path' }, { status: 400 })

  const audio = await streamStoredRecording(path, request.headers.get('range'))
  if (!audio) return new NextResponse('Recording not found', { status: 404 })
  return audio
}
