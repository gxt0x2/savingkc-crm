import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail, isCurrentUserAdmin } from '@/lib/auth/admin'
import { DOCUMENTS_BUCKET } from '@/lib/documents'
import { readCallReviewWorkflow } from '@/lib/marketing/call-recordings'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024
const ALLOWED_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'])

function baseMimeType(type: string) {
  return type.split(';', 1)[0].trim().toLowerCase()
}

function safeExtension(type: string) {
  if (type === 'audio/mp4') return 'm4a'
  if (type === 'audio/ogg') return 'ogg'
  if (type === 'audio/wav') return 'wav'
  if (type === 'audio/mpeg') return 'mp3'
  return 'webm'
}

export async function POST(req: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return NextResponse.json({ error: 'Voiceover uploads must be prepared before direct upload' }, { status: 415 })
  const body = await req.json().catch(() => null) as { activityId?: unknown; mimeType?: unknown; byteSize?: unknown } | null
  const activityId = String(body?.activityId || '')
  const mimeType = String(body?.mimeType || '')
  const normalizedMimeType = baseMimeType(mimeType)
  const byteSize = Number(body?.byteSize || 0)
  if (!activityId || !mimeType) return NextResponse.json({ error: 'Voiceover and call are required' }, { status: 400 })
  if (!ALLOWED_TYPES.has(normalizedMimeType)) return NextResponse.json({ error: 'Unsupported voiceover format' }, { status: 415 })
  if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_BYTES) return NextResponse.json({ error: 'Voiceover must be under 50 MB' }, { status: 413 })

  const db = supabaseAdmin()
  const { data: activity, error } = await db.from('lead_activities').select('id, metadata').eq('id', activityId).eq('activity_type', 'call').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!activity) return NextResponse.json({ error: 'Call recording not found' }, { status: 404 })
  const workflow = readCallReviewWorkflow(activity.metadata)
  if (workflow.status !== 'submitted') return NextResponse.json({ error: 'Call must be awaiting review' }, { status: 409 })
  if (workflow.assignedReviewer !== email && !(await isCurrentUserAdmin())) return NextResponse.json({ error: 'This review is assigned to another reviewer' }, { status: 403 })

  const path = `call-review-voiceovers/${activityId}/${crypto.randomUUID()}.${safeExtension(normalizedMimeType)}`
  const { data: prepared, error: uploadError } = await db.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path, { upsert: false })
  if (uploadError || !prepared?.token) return NextResponse.json({ error: uploadError?.message || 'Voiceover upload could not be prepared' }, { status: 500 })
  return NextResponse.json({ path, token: prepared.token, bucket: DOCUMENTS_BUCKET, mimeType }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const path = req.nextUrl.searchParams.get('path') || ''
  if (!path.startsWith('call-review-voiceovers/')) return NextResponse.json({ error: 'Invalid voiceover path' }, { status: 400 })
  const activityId = path.split('/')[1] || ''
  const db = supabaseAdmin()
  const { data: activity } = await db.from('lead_activities').select('metadata').eq('id', activityId).eq('activity_type', 'call').maybeSingle()
  if (!activity) return NextResponse.json({ error: 'Voiceover not found' }, { status: 404 })
  const workflow = readCallReviewWorkflow(activity.metadata)
  const permitted = [workflow.assignedReviewer, workflow.submittedBy, workflow.completedBy].includes(email) || await isCurrentUserAdmin()
  if (!permitted) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).download(path)
  if (error || !data) return NextResponse.json({ error: error?.message || 'Voiceover not found' }, { status: 404 })
  return new NextResponse(await data.arrayBuffer(), { headers: { 'Content-Type': data.type || 'audio/webm', 'Cache-Control': 'private, max-age=3600' } })
}
