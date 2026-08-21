import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { processProspectingCampaignActions } from '@/lib/server/prospecting-campaign-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  const rawLimit = Number(new URL(request.url).searchParams.get('limit') || 10)
  try {
    return NextResponse.json(await processProspectingCampaignActions(Number.isFinite(rawLimit) ? rawLimit : 10), {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('[prospecting-worker] Worker batch failed', error)
    return NextResponse.json({ error: 'Prospecting campaign worker is unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  }
}

export async function GET(request: Request) {
  return run(request)
}

export async function POST(request: Request) {
  return run(request)
}
