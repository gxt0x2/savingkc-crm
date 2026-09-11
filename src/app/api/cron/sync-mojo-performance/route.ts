import { NextRequest, NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { recordMojoHealthIncident } from '@/lib/server/mojo-health-incident'
import {
  MojoPerformanceSyncError,
  syncCurrentMojoPerformance,
} from '@/lib/server/mojo-performance-sync'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
}

function requestedForce(request: NextRequest): boolean {
  const value = new URL(request.url).searchParams.get('force')?.toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

async function handle(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  const db = supabaseAdmin()
  const startedAt = new Date()
  const force = requestedForce(request)
  console.log(JSON.stringify({
    level: 'info',
    message: 'mojo_performance_sync_started',
    startedAt: startedAt.toISOString(),
    forced: force,
  }))

  try {
    const result = await syncCurrentMojoPerformance({
      db,
      now: startedAt,
      force,
    })
    console.log(JSON.stringify({
      level: 'info',
      message: result.skipped ? 'mojo_performance_sync_skipped' : 'mojo_performance_sync_completed',
      metricDate: result.metricDate,
      sourceFetchedAt: result.sourceFetchedAt ?? null,
      attempts: result.attempts ?? 0,
      applied: result.applied ?? false,
      calls: result.calls ?? null,
      contacts: result.contacts ?? null,
      leads: result.leads ?? null,
      appointments: result.appointments ?? null,
      reason: result.reason ?? null,
    }))
    return NextResponse.json(result, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const code = error instanceof MojoPerformanceSyncError ? error.code : 'provider_unavailable'
    const message = error instanceof Error ? error.message : 'Mojo performance sync failed'
    console.error(JSON.stringify({
      level: 'error',
      message: 'mojo_performance_sync_failed',
      code,
      error: message,
    }))

    try {
      const incident = await recordMojoHealthIncident(db, {
        message,
        reason: code,
        source: 'vercel-mojo-performance',
        sessionStatus: code === 'session_expired' || code === 'session_missing' ? code : null,
        syncHealth: 'down',
        lastSyncAt: null,
      })
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'mojo_performance_sync_incident',
        code,
        incidentCreated: incident.created,
        smsAlerted: incident.alerted,
      }))
    } catch (incidentError) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'mojo_performance_sync_incident_failed',
        code,
        error: incidentError instanceof Error ? incidentError.message : String(incidentError),
      }))
    }

    return NextResponse.json(
      {
        ok: false,
        code,
        error: 'Today\'s Mojo performance could not be refreshed.',
        actionRequired: 'retry_automatically',
      },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
