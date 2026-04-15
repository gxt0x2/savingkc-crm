/**
 * POST /api/leads/appointment-outcome
 *
 * Records the outcome of a scheduled appointment.
 * Updates manifest, logs to lead_activities, and triggers auto-advance if completed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { regenerateBriefing } from '@/lib/briefing-regen'

const VALID_OUTCOMES = ['completed', 'no_show', 'cancelled', 'rescheduled'] as const
type Outcome = (typeof VALID_OUTCOMES)[number]

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { leadId, appointmentId, outcome, notes } = body as {
      leadId: string
      appointmentId?: string
      outcome: Outcome
      notes?: string
    }

    if (!leadId || !outcome) {
      return NextResponse.json(
        { error: 'leadId and outcome are required' },
        { status: 400 },
      )
    }

    if (!VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}` },
        { status: 400 },
      )
    }

    const now = new Date().toISOString()

    // 1. Update manifest: set appointment status, audit trail, briefingStale
    const updated = await updateManifestAndCascade(
      leadId,
      (manifest) => {
        // Ensure pipeline.appointment exists
        if (!manifest.pipeline) (manifest as any).pipeline = {}
        if (!(manifest as any).pipeline.appointment) {
          (manifest as any).pipeline.appointment = {}
        }

        // Set appointment status to the outcome
        ;(manifest as any).pipeline.appointment.status = outcome
        ;(manifest as any).pipeline.appointment.outcomeRecordedAt = now
        if (notes) {
          ;(manifest as any).pipeline.appointment.outcomeNotes = notes
        }

        // If no-show, mark for re-engagement
        if (outcome === 'no_show') {
          ;(manifest as any).pipeline.appointment.reEngagement = {
            needed: true,
            reason: 'no_show',
            markedAt: now,
          }
        }

        // Push to auditTrail
        if (!manifest.auditTrail) (manifest as any).auditTrail = []
        ;(manifest as any).auditTrail.push({
          timestamp: now,
          agent: 'casey',
          action: 'appointment_outcome',
          details: {
            outcome,
            appointmentId: appointmentId || null,
            notes: notes || null,
          },
        })

        // Mark briefing as stale
        if (!manifest.ariIntelligence) (manifest as any).ariIntelligence = {}
        ;(manifest as any).ariIntelligence.briefingStale = true
      },
      'api:appointment-outcome',
    )

    if (!updated) {
      return NextResponse.json(
        { error: 'Lead manifest not found' },
        { status: 404 },
      )
    }

    // 2. Log to lead_activities
    const supabase = getSupabase()
    const outcomeLabels: Record<Outcome, string> = {
      completed: 'Appointment completed',
      no_show: 'Appointment no-show',
      cancelled: 'Appointment cancelled',
      rescheduled: 'Appointment rescheduled',
    }

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'appointment_outcome',
      description: outcomeLabels[outcome] + (notes ? `: ${notes}` : ''),
      agent: 'Casey',
      metadata: {
        outcome,
        appointmentId: appointmentId || null,
        notes: notes || null,
        recordedAt: now,
      },
    })

    // 3. If completed, check auto-advance
    let autoAdvance = null
    if (outcome === 'completed') {
      autoAdvance = await checkAutoAdvance(leadId, 'appointment_completed')
    }

    // 4. Eager briefing regen — appointment outcome is high-value
    regenerateBriefing(leadId, `appointment_${outcome}`).catch(() => {})

    return NextResponse.json({
      success: true,
      outcome,
      autoAdvance: autoAdvance || null,
    })
  } catch (err: any) {
    console.error('appointment-outcome error:', err)
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    )
  }
}
