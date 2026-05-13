import { NextRequest, NextResponse } from 'next/server'
import { ensureManifestExists } from '@/lib/manifest-sync'
import { safeSendSMS } from '@/lib/safe-communications'
import { regenerateBriefing, EAGER_REGEN_EVENTS } from '@/lib/briefing-regen'
import { supabase } from '@/lib/supabase-lazy'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const LEAD_TRIAGE = {
  opportunity: {
    label: 'Real Opportunity',
    station: 'qualified',
    priority: 'hot',
    score: 85,
  },
  lead: {
    label: 'Lead',
    station: 'contacted',
    priority: 'warm',
    score: 55,
  },
  dead: {
    label: 'Dead',
    station: 'dead',
    priority: 'cold',
    score: 0,
  },
} as const

type LeadTriageClassification = keyof typeof LEAD_TRIAGE

function isLeadTriageClassification(value: unknown): value is LeadTriageClassification {
  return typeof value === 'string' && value in LEAD_TRIAGE
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, address, phone, email, source } = body

    let leadId: string | null = null

    // Normalize phone
    const normalizedPhone = phone ? phone.replace(/\D/g, '').replace(/^1/, '') : null

    // Check if lead already exists by phone
    if (normalizedPhone) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', `+1${normalizedPhone}`)
        .single()

      if (existingLead) {
        leadId = existingLead.id
      }
    }

    // If no existing lead, check prospects
    if (!leadId && normalizedPhone) {
      const { lookupProspectByPhone } = await import('@/lib/prospect-lookup')
      const { createEnrichedLeadFromProspect } = await import('@/lib/prospect-to-lead')

      const prospectMatches = await lookupProspectByPhone(`+1${normalizedPhone}`)
      if (prospectMatches.length > 0) {
        leadId = await createEnrichedLeadFromProspect(
          prospectMatches[0],
          `+1${normalizedPhone}`,
          source || 'website_form',
          'warm'
        )
      }
    }

    // If still no lead, create bare lead
    if (!leadId) {
      // Parse address for county detection
      let city, state, zip, county
      if (address) {
        const { parseAddressForCounty } = await import('@/lib/county-enrichment')
        const parsed = parseAddressForCounty(address)
        if (parsed) { city = parsed.city; state = parsed.state; zip = parsed.zip; county = parsed.county }
      }

      const { data, error } = await supabase
        .from('leads')
        .insert({
          full_name: name,
          property_address: address,
          phone: normalizedPhone ? `+1${normalizedPhone}` : null,
          email,
          source: source || 'website_form',
          station: 'new',
          priority: 'normal',
          ...(city ? { city } : {}),
          ...(state ? { state } : {}),
          ...(zip ? { zip } : {}),
          ...(county ? { county } : {}),
        })
        .select('id')
        .single()

      if (error) {
        console.error('Supabase insert error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
      }

      leadId = data.id
    }

    // Create manifest (fire-and-forget)
    if (leadId) ensureManifestExists(leadId).catch(err => console.error('[MANIFEST] Failed:', err))

    const smsText = `🔔 New website lead: ${name} | ${address} | ${phone}`

    await Promise.allSettled([
      safeSendSMS({
        body: smsText,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: process.env.CASEY_PHONE!,
      }),
      safeSendSMS({
        body: smsText,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: process.env.ERNEST_PHONE!,
      }),
    ])

    return NextResponse.json({ success: true, leadId }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads route error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, activity, ...fields } = body

    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400, headers: corsHeaders })
    }

    const activityAgent = typeof activity?.agent === 'string' && activity.agent.trim().length > 0
      ? activity.agent.trim()
      : 'Casey'
    const activityAgentId = activityAgent.toLowerCase().includes('ernest') ? 'ernest' : 'casey'
    const requestedClassification = fields.classification
    const triageClassification = requestedClassification === null || requestedClassification === undefined
      ? null
      : isLeadTriageClassification(requestedClassification)
        ? requestedClassification
        : undefined

    if (triageClassification === undefined) {
      return NextResponse.json({ success: false, error: 'Invalid lead classification' }, { status: 400, headers: corsHeaders })
    }

    const previousTriageLead = triageClassification
      ? await supabase
        .from('leads')
        .select('classification, station, priority')
        .eq('id', id)
        .maybeSingle()
      : null

    if (triageClassification) {
      const triage = LEAD_TRIAGE[triageClassification]
      fields.station ??= triage.station
      fields.priority ??= triage.priority
      fields.opportunity_score = typeof fields.opportunity_score === 'number'
        ? fields.opportunity_score
        : triage.score
    }

    // CRITICAL: Handle appointment_set disposition → manifest write
    if (activity?.disposition === 'appointment_set') {
      const { updateManifestAndCascade, ensureManifestExists } = await import('@/lib/manifest-sync')
      const { checkAutoAdvance } = await import('@/lib/pipeline-auto-advance')
      const { randomUUID } = await import('crypto')

      // 0. Ensure manifest exists
      await ensureManifestExists(id)

      // 1. Update manifest with appointment object
      await updateManifestAndCascade(id, (manifest) => {
        // Create appointment object with all required fields
        manifest.pipeline.appointment = {
          appointmentId: randomUUID(),
          type: 'phone_call', // Default from disposition - can be changed via modal
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Default: tomorrow same time
          createdAt: new Date().toISOString(),
          status: 'scheduled',
          confirmationCount: 0,
          lastSellerResponse: null,
          ghostRiskScore: 0,
          ghostProtocolActive: false,
          reminderAutomationEnabled: true,
          reminderAutomationEnabledAt: new Date().toISOString(),
          reminderAutomationSource: 'call_disposition',
          automationLog: [],
          assignedTo: activityAgentId,
          address: null,
          notes: activity.notes || null,
        }

        // Set station to qualified
        manifest.currentStation = 'qualified'

        // Mark briefing as stale
        if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
        manifest.ariIntelligence.briefingStale = true

        // Add to audit trail
        if (!manifest.auditTrail) manifest.auditTrail = []
        manifest.auditTrail.push({
          timestamp: new Date().toISOString(),
          agent: 'disposition:appointment_set',
          action: 'appointment_created',
          details: {
            source: 'call_disposition',
            notes: activity.notes,
          },
        })
      }, 'disposition:appointment_set')

      // 2. Fire appointment_set auto-advance trigger
      await checkAutoAdvance(id, 'appointment_set')

      // 3. Log to lead_activities for timeline/calendar display
      const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('lead_activities').insert({
        lead_id: id,
        activity_type: 'appointment',
        description: `Appointment scheduled during call${activity.notes ? ': ' + activity.notes : ''}`,
        agent: activityAgent,
        metadata: {
          source: 'call_disposition',
          disposition: activity.disposition,
          scheduled_at: scheduledAt,
          due_date: scheduledAt, // Calendar reads due_date
          status: 'scheduled',
        },
      })

      // Eager briefing regen for appointment_set
      regenerateBriefing(id, 'appointment_set').catch(() => {})
    } else if (activity) {
      // Skip lead_activities insert for notes (already inserted by frontend)
      const isNoteOnly = activity.disposition === 'note_added' || activity.type === 'note'

      if (!isNoteOnly) {
        // Log call disposition as activity
        const description = `Call: ${activity.disposition?.replace(/_/g, ' ') || 'completed'}${activity.notes ? ' - ' + activity.notes : ''}`
        const { error: activityError } = await supabase.from('lead_activities').insert({
          lead_id: id,
          activity_type: 'call',
          description,
          agent: activityAgent,
          metadata: {
            disposition: activity.disposition,
            phone: activity.phone,
            notes: activity.notes,
          },
        })

        if (activityError) {
          console.error('[leads PATCH] Failed to insert activity:', activityError.message)
        }

        // Denormalized snapshot on the leads row so filters / KPIs see the
        // latest contact without having to join lead_activities.
        if (activity.disposition) {
          const leadPatch: Record<string, unknown> = {
            call_result: activity.disposition,
            updated_at: new Date().toISOString(),
          }
          const { error: leadPatchErr } = await supabase
            .from('leads')
            .update(leadPatch)
            .eq('id', id)
          if (leadPatchErr) {
            console.error('[leads PATCH] Failed to update lead snapshot:', leadPatchErr.message)
          }
        }
      }

      // Update manifest with disposition notes + mark briefing stale
      if (activity.notes || activity.disposition) {
        try {
          const { updateManifestAndCascade, ensureManifestExists: ensureManifest } = await import('@/lib/manifest-sync')
          const { checkAutoAdvance } = await import('@/lib/pipeline-auto-advance')
          await ensureManifest(id)
          await updateManifestAndCascade(id, (manifest) => {
            const dispo = activity.disposition || ''

            // Add agent notes to manifest
            if (activity.notes) {
              if (!manifest.agentNotes) manifest.agentNotes = []
              manifest.agentNotes.push({
                timestamp: new Date().toISOString(),
                author: activityAgentId,
                source: 'disposition',
                content: activity.notes,
                callRecordId: activity.phone || undefined,
              })
            }

            // Update disposition on manifest
            if (dispo) {
              if (!manifest.communications) manifest.communications = { transcripts: [] }
              manifest.communications.lastDisposition = dispo
              manifest.communications.lastDispositionDate = new Date().toISOString()
            }

            // Disposition-specific manifest updates
            if (dispo === 'callback_requested') {
              if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
              if (!manifest.ariIntelligence.recommendedActions) manifest.ariIntelligence.recommendedActions = []
              manifest.ariIntelligence.recommendedActions.push({
                action: `Callback requested${activity.notes ? ': ' + activity.notes : ''}`,
                reason: 'seller_requested',
              })
            } else if (dispo === 'deal_potential' || dispo === 'offer_made') {
              manifest.currentStation = dispo === 'offer_made' ? 'offer_made' : 'qualified'
              manifest.priority = 'hot'
            } else if (dispo === 'not_interested' || dispo === 'dead') {
              const triage = LEAD_TRIAGE.dead
              manifest.priority = 'cold'
              if (!manifest.scoring) {
                manifest.scoring = {
                  opportunity_score: triage.score,
                  classification: 'dead',
                  reasoning: `Call disposition marked this lead ${triage.label}.`,
                  worth_enriching: false,
                  scored_at: new Date().toISOString(),
                  scored_by: 'disposition',
                }
              } else {
                manifest.scoring.classification = 'dead'
                manifest.scoring.opportunity_score = triage.score
                manifest.scoring.worth_enriching = false
                manifest.scoring.scored_at = new Date().toISOString()
                manifest.scoring.scored_by = 'disposition'
              }
            } else if (dispo === 'dnc') {
              if (!manifest.flags) manifest.flags = {}
              if (!manifest.flags.redFlags) manifest.flags.redFlags = []
              if (!manifest.flags.redFlags.includes('do_not_contact')) {
                manifest.flags.redFlags.push('do_not_contact')
              }
            } else if (dispo === 'wrong_number' || dispo === 'disconnected') {
              if (!manifest.flags) manifest.flags = {}
              if (!manifest.flags.redFlags) manifest.flags.redFlags = []
              if (!manifest.flags.redFlags.includes('bad_phone')) {
                manifest.flags.redFlags.push('bad_phone')
              }
            }

            // Mark briefing as stale so Ari regenerates with new context
            if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
            manifest.ariIntelligence.briefingStale = true

            // Add audit trail
            if (!manifest.auditTrail) manifest.auditTrail = []
            manifest.auditTrail.push({
              timestamp: new Date().toISOString(),
              agent: 'disposition:' + (dispo || 'unknown'),
              action: 'call_disposition',
              details: {
                disposition: dispo,
                hasNotes: !!activity.notes,
                phone: activity.phone,
              },
            })
          }, 'disposition:' + (activity.disposition || 'call'))

          // Fire auto-advance for meaningful dispositions
          const advanceDispos = ['callback_requested', 'spoke_with_owner', 'deal_potential', 'offer_made']
          if (advanceDispos.includes(activity.disposition)) {
            await checkAutoAdvance(id, activity.disposition).catch(err =>
              console.error('[leads PATCH] Auto-advance failed:', err)
            )
          }

          // Eager briefing regen for high-value dispositions (fire-and-forget)
          if (EAGER_REGEN_EVENTS.has(activity.disposition)) {
            regenerateBriefing(id, activity.disposition).catch(() => {})
          }
        } catch (manifestErr) {
          console.error('[leads PATCH] Manifest update failed:', manifestErr)
        }
      }
    }

    // Manifest-owned fields must cascade through manifest → leads
    const MANIFEST_OWNED = ['station', 'priority', 'motivation_score', 'classification', 'opportunity_score'] as const
    const manifestFields: Record<string, unknown> = {}
    const directFields: Record<string, unknown> = {}

    for (const [key, val] of Object.entries(fields)) {
      if ((MANIFEST_OWNED as readonly string[]).includes(key)) {
        manifestFields[key] = val
      } else {
        directFields[key] = val
      }
    }

    // If manifest-owned fields are being updated, go through manifest cascade
    if (Object.keys(manifestFields).length > 0) {
      const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
      const cascaded = await updateManifestAndCascade(id, (manifest) => {
        if (typeof manifestFields.station === 'string') manifest.currentStation = manifestFields.station
        if (typeof manifestFields.priority === 'string') manifest.priority = manifestFields.priority as 'hot' | 'warm' | 'cold'
        if (typeof manifestFields.motivation_score === 'number') {
          if (!manifest.situation.motivation) manifest.situation.motivation = {}
          manifest.situation.motivation.score = manifestFields.motivation_score
        }
        if (isLeadTriageClassification(manifestFields.classification)) {
          const triage = LEAD_TRIAGE[manifestFields.classification]
          if (!manifest.scoring) {
            manifest.scoring = {
              opportunity_score: triage.score,
              classification: manifestFields.classification,
              reasoning: `Manual lead triage set to ${triage.label}.`,
              worth_enriching: manifestFields.classification !== 'dead',
              scored_at: new Date().toISOString(),
              scored_by: 'notes',
            }
          } else {
            manifest.scoring.classification = manifestFields.classification
            manifest.scoring.opportunity_score = typeof manifestFields.opportunity_score === 'number'
              ? manifestFields.opportunity_score
              : manifest.scoring.opportunity_score ?? triage.score
            manifest.scoring.reasoning = `Manual lead triage set to ${triage.label}.`
            manifest.scoring.worth_enriching = manifestFields.classification !== 'dead'
            manifest.scoring.scored_at = new Date().toISOString()
            manifest.scoring.scored_by = 'notes'
          }
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          manifest.ariIntelligence.briefingStale = true
        } else if (typeof manifestFields.opportunity_score === 'number' && manifest.scoring) {
          manifest.scoring.opportunity_score = manifestFields.opportunity_score
          manifest.scoring.scored_at = new Date().toISOString()
        }
      }, 'api:leads_patch')

      // Fallback to direct write if no manifest exists
      if (!cascaded) {
        Object.assign(directFields, manifestFields)
      }
    }

    // Write non-manifest fields directly to leads table
    if (Object.keys(directFields).length > 0) {
      const { error } = await supabase
        .from('leads')
        .update(directFields)
        .eq('id', id)

      if (error) {
        console.error('Supabase update error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
      }
    }

    // Return updated lead
    const { data, error: fetchError } = await supabase
      .from('leads')
      .select()
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json({ success: false, error: fetchError.message }, { status: 500, headers: corsHeaders })
    }

    const previousTriageData = previousTriageLead?.data ?? null
    if (triageClassification && previousTriageData?.classification !== triageClassification) {
      const triage = LEAD_TRIAGE[triageClassification]
      const { error: triageActivityError } = await supabase.from('lead_activities').insert({
        lead_id: id,
        activity_type: 'status_change',
        description: `Manual triage: ${triage.label}`,
        agent: activityAgent,
        metadata: {
          source: 'lead_detail_triage',
          old_classification: previousTriageData?.classification ?? null,
          new_classification: triageClassification,
          old_station: previousTriageData?.station ?? null,
          new_station: data.station ?? fields.station ?? null,
          old_priority: previousTriageData?.priority ?? null,
          new_priority: data.priority ?? fields.priority ?? null,
        },
      })
      if (triageActivityError) {
        console.error('[leads PATCH] Failed to insert triage activity:', triageActivityError.message)
      }
    }

    return NextResponse.json({ success: true, lead: data }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads PATCH error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { ids } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids array required' }, { status: 400, headers: corsHeaders })
    }

    // Every table in LEAD_FK_TABLES has a lead_id FK to leads.id. Adding a
    // new table with lead_id? Add it here too, or the leads delete will
    // fail with "violates foreign key constraint" and the UI will show it.
    //
    // This list was produced by probing the live Supabase schema (searching
    // information_schema for columns named lead_id). Re-run that probe if
    // this regresses again.
    //
    // `prospects.lead_id` is NULLed (not deleted) because prospects are
    // authoritative cold-outreach data, independent of lead lifecycle.
    const LEAD_FK_TABLES = [
      // Core
      'bookings',
      'lead_activities',
      'mojo_call_queue',
      'hot_opportunities_cache',
      'hot_score_audit_trail',
      // Comms
      'sms_messages',
      'sms_send_log',
      'sms_delivery_log',
      'notifications',
      'call_log',
      'call_sessions',
      'call_queue',
      'voicemail',
      'voicemails',
      'messages',
      'conversation_messages',
      // Feedback / audit
      'feedback',
      'feedback_submissions',
      'feedback_comments',
      'ari_audit_findings',
      'audit_log',
      'activity_log',
      'session_log',
      'error_log',
      // Agent / scoring
      'agent_scorecards',
      'lead_score_history',
      'score_snapshots',
      'temperature_history',
      'lead_analytics_daily',
      'kpi_snapshots',
      // Pipeline / tasks
      'stage_transitions',
      'tasks',
      'property_tasks',
      'appointments',
      'appointment_confirmations',
      'followups',
      'follow_ups',
      'reminders',
      'alerts',
      'assignments',
      'assigned_leads',
      'lead_stages',
      'kanban_positions',
      // Ari
      'ari_briefing_events',
      'ari_briefing_cache',
      'ari_nudges',
      'ari_signals',
      'ari_messages',
      'ari_tasks',
      'ari_follow_ups',
      'ari_context_cache',
      'briefing_cache',
      'nudges',
      // Mail / documents
      'mail_pieces',
      'documents',
      'photos',
      'attachments',
      // Listings / deals
      'listings',
      'deal_history',
      'deal_events',
      'offer_history',
      'escrow',
      'inspections',
      'closings',
      // Tagging / UX
      'lead_tags',
      'tags',
      'stars',
      'favorites',
      'comments',
      'reviews',
      // Ghost / pipeline events
      'ghost_protocol_log',
      'pipeline_events',
      // Dashboards
      'dashboards',
      'daily_digest',
      'weekly_digest',
      'reports',
      'exports',
      // manifests last so its ON DELETE CASCADE children (manifest_history etc)
      // get cleaned up in the same pass.
      'manifests',
    ]

    const results = await Promise.allSettled([
      ...LEAD_FK_TABLES.map(table =>
        supabase.from(table).delete().in('lead_id', ids),
      ),
      supabase.from('prospects').update({ lead_id: null }).in('lead_id', ids),
    ])

    // Surface any unexpected errors from the cleanup step.
    const cleanupErrors = results
      .map((r, i) => r.status === 'rejected' ? `step${i}: ${String(r.reason).slice(0, 200)}` : null)
      .filter(Boolean)
    if (cleanupErrors.length > 0) {
      console.error('Lead cleanup errors (non-fatal, continuing):', cleanupErrors)
    }

    const { error } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)

    if (error) {
      console.error('Supabase delete error:', error)
      return NextResponse.json(
        { success: false, error: error.message, cleanupErrors },
        { status: 500, headers: corsHeaders },
      )
    }

    return NextResponse.json({ success: true, deleted: ids.length, cleanupErrors }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads DELETE error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    const { data, error, count } = await supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
    }

    return NextResponse.json({ success: true, leads: data, total: count }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads GET error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}
