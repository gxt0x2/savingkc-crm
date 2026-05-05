/**
 * Ghost Protocol (Appointment) — Three-step escalation for sellers going cold
 * before their scheduled appointment.
 *
 * DISTINCT from ghost-protocol.ts (pipeline ghost protocol for long-term nurture).
 *
 * Trigger: manifest.pipeline.appointment.ghostProtocolActive flips to true
 * (set by ghost risk calculator when ghostRiskScore >= 50).
 *
 * Steps:
 *   1. Pattern Interrupt SMS (immediate)
 *   2. Casey Direct Call (+2 hrs, if no reply)
 *   3. Door-Open Final SMS (+2 hrs after step 2, if still no reply)
 */

import { createClient } from '@supabase/supabase-js'
import { updateManifestAndCascade } from './manifest-sync'
import { renderTemplate } from './sms-templates'
import { buildQueuedSmsMetadata } from './queued-sms'

const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

const STEP_DELAY_MS = 2 * 60 * 60 * 1000 // 2 hours

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AutomationLogEntry {
  action: string
  channel?: string
  sellerResponded?: boolean
  timestamp: string
  [key: string]: any
}

function findStep(log: AutomationLogEntry[], action: string): AutomationLogEntry | undefined {
  return log.find((entry) => entry.action === action)
}

function msSince(isoTimestamp: string): number {
  return Date.now() - new Date(isoTimestamp).getTime()
}

function sellerRespondedAfter(log: AutomationLogEntry[], afterTimestamp: string): boolean {
  const afterMs = new Date(afterTimestamp).getTime()
  return log.some(
    (entry) =>
      entry.sellerResponded === true &&
      new Date(entry.timestamp).getTime() > afterMs,
  )
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

/**
 * Runs the Ghost Protocol (Appointment) engine for a single lead.
 * Idempotent — safe to call repeatedly; it will execute only the next
 * pending step based on automationLog state.
 */
export async function runGhostProtocolAppointment(leadId: string): Promise<void> {
  const supabase = getSupabase()

  // 1. Load manifest
  const { data: row, error } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest')
    .eq('lead_id', leadId)
    .limit(1)
    .single()

  if (error || !row?.manifest) {
    console.error(`[ghost-appt] No manifest for lead ${leadId}:`, error)
    return
  }

  const manifest = row.manifest as any

  // 2. Verify ghost protocol is active
  const appt = manifest?.pipeline?.appointment
  if (!appt?.ghostProtocolActive) {
    return // Not active — nothing to do
  }

  const automationLog: AutomationLogEntry[] = manifest.automationLog || []
  const ownerFirstName = manifest.owner?.firstName || 'there'
  const ownerPhone = manifest.owner?.phone

  if (!ownerPhone) {
    console.error(`[ghost-appt] No owner phone for lead ${leadId}`)
    return
  }

  const step1 = findStep(automationLog, 'ghost_step_1')
  const step2 = findStep(automationLog, 'ghost_step_2')
  const step3 = findStep(automationLog, 'ghost_step_3')

  // ----- Step 1: Pattern Interrupt SMS (immediate) -----
  if (!step1) {
    const smsBody = renderTemplate('appt_ghost_pattern_interrupt', {
      firstName: ownerFirstName,
    })

    // Create pending SMS in lead_activities
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'sms',
      description: `Ghost Protocol (Appt) Step 1 — Pattern Interrupt SMS`,
      agent: 'Ari',
      metadata: buildQueuedSmsMetadata({
        to: ownerPhone,
        body: smsBody,
        from: TWILIO_PHONE,
        source: 'ghost-protocol-appointment',
        template: 'appt_ghost_pattern_interrupt',
        extra: {
          ghost_protocol: 'appointment',
          ghost_step: 1,
        },
      }),
    })

    // Push step 1 to automationLog via manifest
    await updateManifestAndCascade(leadId, (m: any) => {
      if (!m.automationLog) m.automationLog = []
      m.automationLog.push({
        action: 'ghost_step_1',
        channel: 'sms',
        sellerResponded: false,
        timestamp: new Date().toISOString(),
      })
    }, 'ghost-protocol-appointment')

    // Log to timeline
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'status_change',
      description: 'Ghost Protocol (Appt) activated — Step 1 Pattern Interrupt SMS queued',
      agent: 'Ari',
      metadata: {
        action: 'ghost_appt_step_1',
        ghost_protocol: 'appointment',
      },
    })

    return
  }

  // ----- Step 2: Casey Direct Call (+2 hrs after Step 1, no reply) -----
  if (step1 && !step2) {
    // Check timing
    if (msSince(step1.timestamp) < STEP_DELAY_MS) {
      return // Not yet 2 hours since step 1
    }

    // Check if seller replied
    if (sellerRespondedAfter(automationLog, step1.timestamp)) {
      return // Seller responded — stand down
    }

    // Create urgent call task for Casey
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'call',
      description: `URGENT: Ghost Protocol (Appt) Step 2 — Casey direct call to ${ownerFirstName} (${ownerPhone}). Seller going cold before appointment.`,
      agent: 'Ari',
      metadata: {
        direction: 'outbound',
        to: ownerPhone,
        status: 'pending',
        assigned_to: 'CA',
        priority: 'urgent',
        ghost_protocol: 'appointment',
        ghost_step: 2,
      },
    })

    // Send alert SMS to Casey with ghost context
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'sms',
      description: `Ghost Protocol alert SMS to Casey`,
      agent: 'Ari',
      metadata: buildQueuedSmsMetadata({
        to: CASEY_PHONE,
        from: TWILIO_PHONE,
        body: `GHOST ALERT: ${ownerFirstName} (${ownerPhone}) went cold before appointment. Pattern interrupt SMS sent 2hrs ago — no reply. Please call them directly.`,
        source: 'ghost-protocol-appointment',
        template: 'ghost_appt_casey_alert',
        extra: {
          internal_alert: true,
          ghost_protocol: 'appointment',
          ghost_step: 2,
        },
      }),
    })

    // Push step 2 to automationLog
    await updateManifestAndCascade(leadId, (m: any) => {
      if (!m.automationLog) m.automationLog = []
      m.automationLog.push({
        action: 'ghost_step_2',
        channel: 'call',
        sellerResponded: false,
        timestamp: new Date().toISOString(),
        assignedTo: 'Casey',
      })
    }, 'ghost-protocol-appointment')

    // Log to timeline
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'status_change',
      description: 'Ghost Protocol (Appt) Step 2 — Casey direct call task created',
      agent: 'Ari',
      metadata: {
        action: 'ghost_appt_step_2',
        ghost_protocol: 'appointment',
      },
    })

    return
  }

  // ----- Step 3: Door-Open Final SMS (+2 hrs after Step 2, still no reply) -----
  if (step2 && !step3) {
    // Check timing
    if (msSince(step2.timestamp) < STEP_DELAY_MS) {
      return // Not yet 2 hours since step 2
    }

    // Check if seller replied
    if (sellerRespondedAfter(automationLog, step2.timestamp)) {
      return // Seller responded — stand down
    }

    const smsBody = renderTemplate('ghost_appt_door_open', {
      firstName: ownerFirstName,
      agentName: 'Casey',
    })

    // Send door-open SMS
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'sms',
      description: `Ghost Protocol (Appt) Step 3 — Door-Open Final SMS`,
      agent: 'Ari',
      metadata: buildQueuedSmsMetadata({
        to: ownerPhone,
        body: smsBody,
        from: TWILIO_PHONE,
        source: 'ghost-protocol-appointment',
        template: 'ghost_appt_door_open',
        extra: {
          ghost_protocol: 'appointment',
          ghost_step: 3,
        },
      }),
    })

    // Push step 3 to automationLog
    await updateManifestAndCascade(leadId, (m: any) => {
      if (!m.automationLog) m.automationLog = []
      m.automationLog.push({
        action: 'ghost_step_3',
        channel: 'sms',
        sellerResponded: false,
        timestamp: new Date().toISOString(),
      })

      // If appointment time has passed, mark as no_show
      const apptTime = m.pipeline?.appointment?.dateTime
      if (apptTime && new Date(apptTime).getTime() < Date.now()) {
        if (!m.pipeline) m.pipeline = {}
        if (!m.pipeline.appointment) m.pipeline.appointment = {}
        m.pipeline.appointment.status = 'no_show'
      }
    }, 'ghost-protocol-appointment')

    // Log to timeline
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'status_change',
      description: 'Ghost Protocol (Appt) Step 3 — Door-Open Final SMS sent. Escalation complete.',
      agent: 'Ari',
      metadata: {
        action: 'ghost_appt_step_3',
        ghost_protocol: 'appointment',
      },
    })

    return
  }

  // All 3 steps executed — protocol complete, nothing more to do.
}

// ---------------------------------------------------------------------------
// Activation helper
// ---------------------------------------------------------------------------

/**
 * Checks if Ghost Protocol (Appointment) should be activated for a manifest.
 * Returns true if ghostRiskScore >= 50 AND ghostProtocolActive is not already true.
 */
export function shouldActivateGhostProtocol(manifest: any): boolean {
  const appt = manifest?.pipeline?.appointment
  if (!appt) return false
  if (appt.ghostProtocolActive) return false // Already active
  return (appt.ghostRiskScore || 0) >= 50
}
