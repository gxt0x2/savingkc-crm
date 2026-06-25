import { NextResponse } from 'next/server'
import { isOptedOut, handleOptOut, handleOptIn, isStopKeyword, isStartKeyword } from '@/lib/sms-opt-out'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { rateLimit, rateLimitConfigs, getClientIp } from '@/middleware/rate-limit'
import { onCommunicationEvent, ensureManifestExists } from '@/lib/manifest-sync'
import { regenerateBriefing } from '@/lib/briefing-regen'
import { sendPushToAgents } from '@/lib/push-notifications'
import { lookupProspectByPhone } from '@/lib/prospect-lookup'
import { createEnrichedLeadFromProspect, formatProspectAlert } from '@/lib/prospect-to-lead'
import type { ProspectMatch } from '@/lib/prospect-lookup'
import { safeSendSMS } from '@/lib/safe-communications'
import { formatPhone } from '@/lib/format'
import { supabase } from '@/lib/supabase-lazy'
import { isGoogleAdsPhoneNumber } from '@/lib/call-quality-events'
import {
  googleAdsNewTextTeamMessage,
  markLeadAsGoogleAdsPhoneLead,
  notifyGoogleAdsTeam,
  phoneLookupVariants,
  resolveGoogleAdsLeadContext,
} from '@/lib/google-ads-phone'

const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

function isOfficeHours(): boolean {
  const now = new Date()
  const cst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const hour = cst.getHours()
  return hour >= 9 && hour < 17
}

// Team numbers — never trigger auto-reply flows for these
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey personal
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
  '+18162262552', // Ernest personal
])

type SmsSuppressionReason = 'SPAM' | 'BLOCKED' | 'DNC' | 'WRONG_NUMBER' | string

async function findLeadByPhone(phone: string) {
  for (const variant of phoneLookupVariants(phone)) {
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, phone, station, priority')
      .eq('phone', variant)
      .limit(1)
      .maybeSingle()
    if (data) return data
  }
  return null
}

async function smsSuppressionReason(phone: string): Promise<SmsSuppressionReason | null> {
  const { data } = await supabase
    .from('sms_opt_outs')
    .select('reason')
    .eq('phone', phone)
    .eq('is_opted_out', true)
    .maybeSingle()

  return typeof data?.reason === 'string' ? data.reason.toUpperCase() : null
}

function isHardBlockedReason(reason: SmsSuppressionReason | null): boolean {
  return reason === 'SPAM' || reason === 'BLOCKED'
}

export async function POST(req: Request) {
  try {
    // Twilio signature validation
    const isValid = await validateTwilioWebhook(req)
    if (!isValid) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // IP-based rate limiting
    const ip = getClientIp(req)
    const { allowed } = rateLimit(ip, rateLimitConfigs.webhook)
    if (!allowed) {
      return new NextResponse('Rate limited', { status: 429 })
    }

    const body = await req.formData()
    const from = body.get('From') as string
    const to = body.get('To') as string
    const messageBody = body.get('Body') as string
    const messageSid = body.get('MessageSid') as string
    const isGoogleAdsSms = isGoogleAdsPhoneNumber(to || '')

    if (!from || !messageBody) {
      return new NextResponse('Missing required fields', { status: 400 })
    }

    const trimmedUpper = messageBody.trim().toUpperCase()

    // --- TCPA: STOP keyword handling (before ANY processing) ---
    if (isStopKeyword(messageBody)) {
      await handleOptOut(from, messageBody.trim())
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been unsubscribed from Saving KC messages. Reply START to re-subscribe.</Message>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // --- TCPA: START keyword handling ---
    if (isStartKeyword(messageBody)) {
      await handleOptIn(from)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been re-subscribed to Saving KC messages. Reply STOP to unsubscribe.</Message>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // --- "YES" from opted-out number = opt-in, not seller confirmation ---
    if (trimmedUpper === 'YES' && await isOptedOut(from)) {
      await handleOptIn(from)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been re-subscribed to Saving KC messages. Reply STOP to unsubscribe.</Message>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // Match sender phone number to a lead in the database. Twilio sends E.164,
    // but older imports can store national/formatted variants.
    const lead = await findLeadByPhone(from)
    const leadId = lead?.id || null
    const leadName = lead?.full_name || 'Unknown'
    const suppressionReason = await smsSuppressionReason(from)

    // Prospect lookup for unknown senders
    let prospectMatch: ProspectMatch | null = null
    if (!lead && !isHardBlockedReason(suppressionReason)) {
      const matches = await lookupProspectByPhone(from)
      prospectMatch = matches.length > 0 ? matches[0] : null
    }

    // Log the inbound SMS to lead_activities
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'sms',
      description: messageBody,
      agent: 'system',
      metadata: {
        ...(prospectMatch ? {
          source: 'tax_delinquent_inbound_sms',
          prospect_id: prospectMatch.prospect_id,
          heir_name: prospectMatch.contact_name,
          heir_relation: prospectMatch.relationship,
        } : {}),
        direction: 'received',
        from,
        to,
        message_sid: messageSid,
        lead_name: leadName,
      },
    })

    // Sync to manifest (fire-and-forget)
    if (leadId) {
      onCommunicationEvent(leadId, { type: 'inbound_sms', content: messageBody }).catch(err => console.error('[MANIFEST] Failed:', err))
    }

    if (isHardBlockedReason(suppressionReason)) {
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // ── Team numbers: log + notify, but skip auto-reply/lead creation ──
    if (TEAM_NUMBERS.has(from)) {
      // Still notify — team messages shouldn't be silently swallowed
      const teamMember = from === CASEY_PHONE ? 'Casey' :
                         from === ERNEST_PHONE ? 'Ernest' :
                         from === '+18166088588' ? 'Ernest (co)' :
                         from === '+18167277667' ? 'Casey (co)' : 'Team'
      const teamAlert = `📩 ${teamMember} texted ${to}: "${messageBody.slice(0, 100)}"`

      // Push notification to CRM
      sendPushToAgents({
        title: `Team SMS: ${teamMember}`,
        body: messageBody.slice(0, 80),
        url: '/conversations',
        tag: 'team-sms',
      }).catch(() => {})

      // Log to activities so it shows in Conversations
      try {
        await supabase.from('lead_activities').insert({
          lead_id: null,
          activity_type: 'sms',
          description: teamAlert,
          agent: 'system',
          metadata: {
            direction: 'received',
            from,
            to,
            message_sid: messageSid,
            team_member: teamMember,
            is_team: true,
          },
        })
      } catch {}

      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    if (isGoogleAdsSms) {
      let googleAdsLeadId = leadId
      let googleAdsLeadName = leadName

      if (googleAdsLeadId) {
        await markLeadAsGoogleAdsPhoneLead(googleAdsLeadId, from, leadName, to)
      } else {
        const googleAdsLead = await resolveGoogleAdsLeadContext(from, to)
        googleAdsLeadId = googleAdsLead.leadId
        googleAdsLeadName = googleAdsLead.leadName || googleAdsLeadName
      }

      if (googleAdsLeadId) {
        await supabase.from('lead_activities')
          .update({ lead_id: googleAdsLeadId })
          .eq('metadata->>message_sid', messageSid)
          .is('lead_id', null)

        onCommunicationEvent(googleAdsLeadId, { type: 'inbound_sms', content: messageBody }).catch(err => console.error('[MANIFEST] Failed:', err))
      }

      await notifyGoogleAdsTeam(
        googleAdsNewTextTeamMessage(from, messageBody, googleAdsLeadId, to),
        {
          leadId: googleAdsLeadId,
          trigger: 'google_ads_inbound_sms',
          calledNumber: to,
          metadata: {
            direction: 'outbound_alert',
            from,
            to,
            message_sid: messageSid,
            lead_name: googleAdsLeadName,
          },
        },
      )

      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // ── Keyword detection & auto-reply logic ────────────────
    const msg = messageBody.trim().toUpperCase()

    // ── Quick-confirm: if lead has active appointment, low-friction keywords confirm it ──
    const CONFIRM_KEYWORDS = new Set(['1', 'YES', 'YES!', 'Y', 'YEP', 'YEAH', 'YA', 'OK', 'OKAY', 'SURE', 'SOUNDS GOOD', 'CONFIRM', 'CONFIRMED', 'CONFIRM!', 'YES PLEASE', 'PERFECT', 'SEE YOU THEN', 'WILL BE THERE', 'IM GOOD', "I'M GOOD", 'WORKS FOR ME'])
    if (leadId && CONFIRM_KEYWORDS.has(msg)) {
      // Check if this lead has an active appointment
      const { data: manifestRow } = await supabase
        .from('manifests')
        .select('manifest')
        .eq('lead_id', leadId)
        .single()

      const appt = manifestRow?.manifest?.pipeline?.appointment
      const activeStatuses = ['scheduled', 'confirmed', 'reconfirmed']
      if (appt && activeStatuses.includes(appt.status)) {
        // Route to appointment confirmation instead of "wants to sell" flow
        try {
          const { updateManifestAndCascade } = await import('@/lib/manifest-sync')

          await updateManifestAndCascade(leadId, (manifest) => {
            const a = manifest.pipeline?.appointment
            if (!a) return
            a.confirmationCount = (a.confirmationCount || 0) + 1
            a.lastSellerResponse = new Date().toISOString()
            a.status = a.confirmationCount > 1 ? 'reconfirmed' : 'confirmed'
            a.ghostRiskScore = Math.max(0, (a.ghostRiskScore || 0) - 30)

            if (!a.automationLog) a.automationLog = []
            a.automationLog.push({
              timestamp: new Date().toISOString(),
              action: 'seller_confirmed',
              channel: 'sms',
              sellerResponded: true,
            })

            if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
            manifest.ariIntelligence.briefingStale = true
          }, 'twilio:quick_confirm')

          await supabase.from('lead_activities').insert({
            lead_id: leadId,
            activity_type: 'appointment_confirmed',
            description: `Seller confirmed appointment via SMS ("${messageBody.trim()}")`,
            agent: 'Seller',
            metadata: { source: 'sms_reply', keyword: msg, original_message: messageBody.trim() },
          })

          regenerateBriefing(leadId, 'appointment_confirmed').catch(() => {})

          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Message>You're all set! We'll see you then. — Saving KC</Message></Response>`,
            { headers: { 'Content-Type': 'text/xml' } }
          )
        } catch (err) {
          console.error('Quick-confirm failed:', err)
          // Fall through to normal YES handling
        }
      }
    }

    // ── YES reply (from IVR no-input or missed call text-back) ──
    if (msg === 'YES' || msg === 'YES!' || msg === 'YES PLEASE' || msg === 'Y') {
      let yesLeadId = leadId

      // Create lead if unknown caller
      if (!yesLeadId) {
        if (prospectMatch) {
          // Tax delinquent prospect — create enriched lead
          yesLeadId = await createEnrichedLeadFromProspect(prospectMatch, from, 'tax_delinquent_inbound_sms', 'hot') || undefined
        } else {
          const { data: newLead } = await supabase.from('leads').insert({
            full_name: 'Inbound Seller (YES reply)',
            phone: from,
            source: 'sms_yes_reply',
            station: 'new',
            priority: 'hot',
          }).select('id').single()
          yesLeadId = newLead?.id
        }
      } else {
        // Bump existing lead to hot — manifest is source of truth, cascade handles leads
        const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
        const cascaded = await updateManifestAndCascade(yesLeadId, (m) => {
          m.priority = 'hot'
        }, 'system:sms_yes_reply')
        if (!cascaded) {
          // No manifest yet — fall back to direct update
          await supabase.from('leads')
            .update({ priority: 'hot' })
            .eq('id', yesLeadId)
        }
      }

      // Alert BOTH agents — primary based on office hours
      const prospectCtx = prospectMatch ? `\n🏠 ${formatProspectAlert(prospectMatch)}` : ''
      const yesAlertBody = prospectMatch
        ? `🔥 TAX PROSPECT replied YES! ${prospectMatch.owner_1 || from}${prospectCtx}${yesLeadId ? '\n' + BASE_URL + '/leads/' + yesLeadId : ''}`
        : `🔥 HOT: ${leadName !== 'Unknown' ? leadName : from} replied YES to sell. Call NOW.${yesLeadId ? ' ' + BASE_URL + '/leads/' + yesLeadId : ''}`
      const primaryAgent = isOfficeHours() ? CASEY_PHONE : ERNEST_PHONE
      const secondaryAgent = isOfficeHours() ? ERNEST_PHONE : CASEY_PHONE
      await Promise.allSettled([
        safeSendSMS({ body: yesAlertBody, from: TWILIO_PHONE, to: primaryAgent }),
        safeSendSMS({ body: yesAlertBody, from: TWILIO_PHONE, to: secondaryAgent }),
      ])

      // Push notification
      sendPushToAgents({
        title: 'HOT: YES Reply',
        body: `${leadName !== 'Unknown' ? leadName : from} replied YES to sell. Call NOW.`,
        url: yesLeadId ? `/leads/${yesLeadId}` : '/',
        tag: 'yes-reply',
      }).catch(() => {})

      // Log the alert SMS
      if (yesLeadId) {
        await supabase.from('lead_activities').insert({
          lead_id: yesLeadId,
          activity_type: 'sms',
          description: yesAlertBody,
          agent: 'System',
          metadata: { direction: 'outbound_alert', to_agents: ['Casey', 'Ernest'], trigger: 'yes_reply_alert' },
        })
      }

      // Create callback task + Ari briefing event
      const primaryName = isOfficeHours() ? 'Casey' : 'Ernest'
      if (yesLeadId) {
        await supabase.from('lead_activities').insert({
          lead_id: yesLeadId,
          activity_type: 'task',
          description: `URGENT: ${leadName !== 'Unknown' ? leadName : from} replied YES — call back NOW`,
          agent: 'Ari',
          metadata: {
            task_type: 'callback',
            due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            assigned_to: primaryName,
            priority: 'critical',
            status: 'pending',
          },
        })

        await supabase.from('ari_briefing_events').insert({
          event_type: 'yes_reply_seller',
          priority: 'critical',
          title: `🔥 ${leadName !== 'Unknown' ? leadName : from} replied YES — wants to sell`,
          description: `Replied YES to auto-text. Casey notified. Phone: ${from}`,
          lead_id: yesLeadId,
          action_url: `/leads/${yesLeadId}`,
        })

        // Sync YES reply to manifest (high-intent signal)
        onCommunicationEvent(yesLeadId, { type: 'yes_reply', content: messageBody }).catch(err => console.error('[MANIFEST] Failed:', err))

        // Eager briefing regen — YES reply is the highest-value signal
        regenerateBriefing(yesLeadId, 'yes_reply').catch(() => {})
      }

      // Reply to seller
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Perfect! We'll call you right back in just a few minutes. — Saving KC Homebuyers</Message></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    // ── CONFIRM/CONFIRMED keyword (Sprint 1 S1-04) ──
    if (msg === 'CONFIRM' || msg === 'CONFIRMED' || msg === 'CONFIRM!') {
      if (leadId) {
        try {
          const { updateManifestAndCascade } = await import('@/lib/manifest-sync')

          // Update manifest with confirmation
          await updateManifestAndCascade(leadId, (manifest) => {
            const appt = manifest.pipeline?.appointment
            if (appt) {
              // Increment confirmation count
              appt.confirmationCount = (appt.confirmationCount || 0) + 1

              // Set last seller response
              appt.lastSellerResponse = new Date().toISOString()

              // Update status to confirmed/reconfirmed
              if (appt.status === 'confirmed' || appt.confirmationCount > 1) {
                appt.status = 'reconfirmed'
              } else {
                appt.status = 'confirmed'
              }

              // Lower ghost risk score on confirmation
              appt.ghostRiskScore = Math.max(0, (appt.ghostRiskScore || 0) - 30)

              // Log to automation log
              if (!appt.automationLog) appt.automationLog = []
              appt.automationLog.push({
                timestamp: new Date().toISOString(),
                action: 'seller_confirmed',
                channel: 'sms',
                sellerResponded: true,
              })
            }

            // Mark briefing as stale
            if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
            manifest.ariIntelligence.briefingStale = true

            // Add to audit trail
            if (!manifest.auditTrail) manifest.auditTrail = []
            manifest.auditTrail.push({
              timestamp: new Date().toISOString(),
              agent: 'twilio:confirm_reply',
              action: 'appointment_confirmed',
              details: {
                confirmationCount: manifest.pipeline?.appointment?.confirmationCount || 0,
                status: manifest.pipeline?.appointment?.status,
              },
            })
          }, 'twilio:confirm_reply')

          // Log to lead_activities for timeline
          await supabase.from('lead_activities').insert({
            lead_id: leadId,
            activity_type: 'appointment_confirmed',
            description: 'Seller confirmed appointment via SMS',
            agent: 'Seller',
            metadata: { source: 'sms_reply', keyword: 'CONFIRM' },
          })

          // Eager briefing regen — appointment confirmation is high-value
          regenerateBriefing(leadId, 'appointment_confirmed').catch(() => {})

          // Send acknowledgment reply
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Perfect! Your appointment is confirmed. We'll see you then! — Saving KC</Message></Response>`,
            { headers: { 'Content-Type': 'text/xml' } }
          )
        } catch (err) {
          console.error('Failed to process CONFIRM keyword:', err)
        }
      }
      // If no lead found, fall through to default handling
    }

    // ── Active appointment reply handler (any inbound from lead with scheduled appt) ──
    if (leadId) {
      try {
        const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
        const { calculateGhostRisk } = await import('@/lib/ghost-risk-calculator')

        // Fetch current manifest to check for active appointment
        const { data: manifestRow } = await supabase
          .from('lead_manifest')
          .select('manifest')
          .eq('lead_id', leadId)
          .single()

        const manifest = manifestRow?.manifest
        const appt = manifest?.pipeline?.appointment
        const activeStatuses = ['scheduled', 'confirmed', 'reconfirmed']

        if (appt && activeStatuses.includes(appt.status)) {
          // Reschedule language detection
          const lowerMsg = messageBody.trim().toLowerCase()
          const reschedulePatterns = [
            'reschedule',
            "can't make it",
            'cant make it',
            'another time',
            'push back',
            'different day',
            'different time',
          ]
          // 'move' checked with word boundary to avoid false positives
          const isReschedule = reschedulePatterns.some(p => lowerMsg.includes(p)) ||
            /\bmove\b/.test(lowerMsg)

          await updateManifestAndCascade(leadId, (m) => {
            const a = m.pipeline?.appointment
            if (!a) return

            // Record seller response timestamp
            a.lastSellerResponse = new Date().toISOString()

            // Push to automation log
            if (!a.automationLog) a.automationLog = []
            a.automationLog.push({
              timestamp: new Date().toISOString(),
              action: 'seller_reply',
              channel: 'sms',
              sellerResponded: true,
            })

            if (isReschedule) {
              // Seller wants to reschedule
              a.status = 'rescheduled'
            } else {
              // Ambiguous reply — bump ghost risk slightly
              a.ghostRiskScore = (a.ghostRiskScore || 0) + 15
            }

            // Recalculate ghost risk from full manifest
            const recalculated = calculateGhostRisk(m)
            a.ghostRiskScore = recalculated

            // Mark briefing as stale
            if (!m.ariIntelligence) m.ariIntelligence = {}
            m.ariIntelligence.briefingStale = true
          }, 'twilio:appointment_reply')

          // If reschedule, create urgent callback task for Casey
          if (isReschedule) {
            await supabase.from('lead_activities').insert({
              lead_id: leadId,
              activity_type: 'task',
              description: `URGENT: ${leadName} wants to reschedule appointment. Message: "${messageBody.slice(0, 100)}"`,
              agent: 'System',
              metadata: {
                task_type: 'callback',
                due_date: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                assigned_to: 'Casey',
                priority: 'critical',
                status: 'pending',
              },
            })
          }
        }
      } catch (err) {
        console.error('Appointment reply handler error:', err)
      }
      // Fall through — do not return early
    }

    // ── STOP / DNC handling (secondary logging — TCPA opt-out already handled above) ──
    if (msg === 'STOP' || msg === 'UNSUBSCRIBE' || msg === 'CANCEL') {
      // Twilio handles STOP automatically at carrier level
      // But log it so we know
      if (leadId) {
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'status_change',
          description: `Opt-out received: "${messageBody.trim()}"`,
          agent: 'System',
          metadata: { trigger: 'sms_opt_out', from },
        })
      }
      // Don't reply — Twilio sends its own STOP confirmation
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // ── Known lead replies (any message = alert BOTH agents) ──
    if (lead) {
      const alertBody = `📩 ${leadName} just texted: "${messageBody.slice(0, 100)}" — ${BASE_URL}/leads/${leadId}`

      // Send alerts to both agents
      const [caseyResult, ernestResult] = await Promise.all([
        safeSendSMS({ body: alertBody, from: TWILIO_PHONE, to: CASEY_PHONE }),
        safeSendSMS({ body: alertBody, from: TWILIO_PHONE, to: ERNEST_PHONE }),
      ])

      // Log success/failure for monitoring
      const caseySuccess = caseyResult.success
      const ernestSuccess = ernestResult.success

      if (!caseySuccess) {
        console.error(`[ALERT-FAILED] Casey alert failed: ${caseyResult.error}`)
      }
      if (!ernestSuccess) {
        console.error(`[ALERT-FAILED] Ernest alert failed: ${ernestResult.error}`)
      }

      // Push notification as backup
      sendPushToAgents({
        title: 'Lead Texted',
        body: `${leadName}: "${messageBody.slice(0, 80)}"`,
        url: `/leads/${leadId}`,
        tag: 'lead-sms',
      }).catch(() => {})

      // Log the alert intent and delivery status
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'sms',
        description: alertBody,
        agent: 'System',
        metadata: {
          direction: 'outbound_alert',
          to_agents: ['Casey', 'Ernest'],
          trigger: 'lead_reply_alert',
          delivery_status: {
            casey: { success: caseySuccess, sid: caseyResult.sid, error: caseyResult.error },
            ernest: { success: ernestSuccess, sid: ernestResult.sid, error: ernestResult.error },
          },
        },
      })

      // CRITICAL: If both alerts fail, log to console prominently
      if (!caseySuccess && !ernestSuccess) {
        console.error('🚨 [CRITICAL] BOTH team SMS alerts failed!')
        console.error(`  Lead: ${leadName}`)
        console.error(`  Message: ${messageBody.slice(0, 100)}`)
        console.error(`  Casey error: ${caseyResult.error}`)
        console.error(`  Ernest error: ${ernestResult.error}`)
      }
    }

    // ── Unknown number — create/enrich lead, alert agents, create task. No generic seller auto-reply. ──
    if (!lead) {
      let newLeadId: string | null = null

      if (prospectMatch) {
        // Tax delinquent prospect — create enriched lead
        newLeadId = await createEnrichedLeadFromProspect(prospectMatch, from, 'tax_delinquent_inbound_sms', 'warm')
      } else {
        // Generic unknown SMS — create basic lead
        const { data: newLead } = await supabase.from('leads').insert({
          full_name: `SMS Lead ${formatPhone(from) || from}`,
          phone: from,
          source: 'inbound_sms',
          station: 'new',
          priority: 'warm',
        }).select('id').single()
        newLeadId = newLead?.id || null

        if (newLeadId) {
          ensureManifestExists(newLeadId).then(() => {
            onCommunicationEvent(newLeadId!, { type: 'inbound_sms', content: messageBody }).catch(err => console.error('[MANIFEST] Failed:', err))
          }).catch(err => console.error('[MANIFEST] Failed:', err))
        }
      }

      if (newLeadId) {
        // Re-link the already-logged SMS to the new lead
        await supabase.from('lead_activities')
          .update({ lead_id: newLeadId })
          .eq('metadata->>message_sid', messageSid)
          .is('lead_id', null)

        // Alert both agents — include prospect context if matched
        const unknownProspectCtx = prospectMatch ? `\n🏠 ${formatProspectAlert(prospectMatch)}` : ''
        const smsAlert = prospectMatch
          ? `🔥 TAX PROSPECT texted! ${prospectMatch.owner_1 || formatPhone(from)}: "${messageBody.slice(0, 60)}"${unknownProspectCtx}\n${BASE_URL}/leads/${newLeadId}`
          : `📩 New text from unknown number ${formatPhone(from)}: "${messageBody.slice(0, 80)}" ${BASE_URL}/leads/${newLeadId}`
        await Promise.allSettled([
          safeSendSMS({ body: smsAlert, from: TWILIO_PHONE, to: CASEY_PHONE }),
          safeSendSMS({ body: smsAlert, from: TWILIO_PHONE, to: ERNEST_PHONE }),
        ])

        // Log the alert
        await supabase.from('lead_activities').insert({
          lead_id: newLeadId,
          activity_type: 'sms',
          description: smsAlert,
          agent: 'System',
          metadata: { direction: 'outbound_alert', to_agents: ['Casey', 'Ernest'], trigger: prospectMatch ? 'prospect_sms_alert' : 'unknown_sms_alert' },
        })

        // Create callback task
        const primaryAgent = isOfficeHours() ? 'Casey' : 'Ernest'
        await supabase.from('lead_activities').insert({
          lead_id: newLeadId,
          activity_type: 'task',
          description: prospectMatch
            ? `TAX PROSPECT: ${prospectMatch.owner_1 || from} texted. ${formatProspectAlert(prospectMatch)}`
            : `Follow up: Unknown number ${from} texted "${messageBody.slice(0, 60)}"`,
          agent: 'System',
          metadata: {
            task_type: 'callback',
            due_date: new Date(Date.now() + (prospectMatch ? 5 : 15) * 60 * 1000).toISOString(),
            assigned_to: primaryAgent,
            priority: prospectMatch ? 'critical' : 'high',
            status: 'pending',
          },
        })

        // Push notification
        sendPushToAgents({
          title: prospectMatch ? 'Tax Prospect Texted!' : 'Unknown SMS',
          body: prospectMatch
            ? `${prospectMatch.owner_1 || from}: "${messageBody.slice(0, 60)}"`
            : `${from}: "${messageBody.slice(0, 60)}"`,
          url: `/leads/${newLeadId}`,
          tag: prospectMatch ? 'prospect-sms' : 'unknown-sms',
        }).catch(() => {})

        // Ari briefing event — include prospect metadata
        try {
          await supabase.from('ari_briefing_events').insert({
            event_type: prospectMatch ? 'prospect_inbound_sms' : 'unknown_sms',
            priority: prospectMatch ? 'critical' : 'medium',
            title: prospectMatch
              ? `Tax prospect texted: ${prospectMatch.owner_1 || formatPhone(from)}`
              : `New text from unknown: ${formatPhone(from)}`,
            description: prospectMatch
              ? `Message: "${messageBody.slice(0, 120)}". ${formatProspectAlert(prospectMatch)}`
              : `Message: "${messageBody.slice(0, 120)}". Lead created, agents notified.`,
            lead_id: newLeadId,
            action_url: `/leads/${newLeadId}`,
            metadata: prospectMatch ? {
              parcel_id: prospectMatch.parcel_id,
              county: prospectMatch.county,
              cumulative_due: prospectMatch.cumulative_due,
              is_deceased: prospectMatch.is_deceased,
              property_address: prospectMatch.situs_street || prospectMatch.situs_address,
            } : undefined,
          })
        } catch {}
      }

      // Generic unknown/prospect texts are human takeover only. Missed-call and
      // explicit YES flows can still acknowledge in their scoped handlers above.
    }

    // No auto-reply for general messages from known leads — keep it human
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })

  } catch (err) {
    console.error('Twilio SMS webhook error:', err)
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200, // Return 200 so Twilio doesn't retry
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
