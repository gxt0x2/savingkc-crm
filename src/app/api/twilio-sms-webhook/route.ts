import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { isOptedOut, handleOptOut, handleOptIn, isStopKeyword, isStartKeyword } from '@/lib/sms-opt-out'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { rateLimit, rateLimitConfigs, getClientIp, phoneRateLimit } from '@/middleware/rate-limit'
import { onCommunicationEvent, ensureManifestExists } from '@/lib/manifest-sync'
import { sendPushToAgents } from '@/lib/push-notifications'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'
import { lookupProspectByPhone } from '@/lib/prospect-lookup'
import { createEnrichedLeadFromProspect, formatProspectAlert } from '@/lib/prospect-to-lead'
import type { ProspectMatch } from '@/lib/prospect-lookup'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

// Random delay to make auto-texts feel human
function sendDelayed(fn: () => Promise<void>, minSec: number, maxSec: number) {
  const delay = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000
  setTimeout(() => fn().catch(e => console.error('Delayed send failed:', e)), delay)
}

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

    // Match sender phone number to a lead in the database
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone, station, priority')
      .eq('phone', from)
      .limit(1)

    const lead = leads && leads.length > 0 ? leads[0] : null
    const leadId = lead?.id || null
    const leadName = lead?.full_name || 'Unknown'

    // Prospect lookup for unknown senders
    let prospectMatch: ProspectMatch | null = null
    if (!lead) {
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
        direction: 'received',
        from,
        to,
        message_sid: messageSid,
        lead_name: leadName,
      },
    })

    // Sync to manifest (fire-and-forget)
    if (leadId) {
      onCommunicationEvent(leadId, { type: 'inbound_sms', content: messageBody }).catch(() => {})
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

    // ── Keyword detection & auto-reply logic ────────────────
    const msg = messageBody.trim().toUpperCase()

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
            station: 'intake',
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
        twilioClient.messages.create({ body: yesAlertBody, from: TWILIO_PHONE, to: primaryAgent }),
        twilioClient.messages.create({ body: yesAlertBody, from: TWILIO_PHONE, to: secondaryAgent }),
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
        onCommunicationEvent(yesLeadId, { type: 'yes_reply', content: messageBody }).catch(() => {})
      }

      // Reply to seller
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Perfect! We'll call you right back in just a few minutes. — Saving KC Homebuyers</Message></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      )
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

    // ── Known hot lead replies (any message = alert BOTH agents) ──
    if (lead && lead.priority === 'hot') {
      const hotAlertBody = `📩 ${leadName} (hot lead) just texted: "${messageBody.slice(0, 100)}" — ${BASE_URL}/leads/${leadId}`
      await Promise.allSettled([
        twilioClient.messages.create({ body: hotAlertBody, from: TWILIO_PHONE, to: CASEY_PHONE }),
        twilioClient.messages.create({ body: hotAlertBody, from: TWILIO_PHONE, to: ERNEST_PHONE }),
      ])
      sendPushToAgents({
        title: 'Hot Lead Texted',
        body: `${leadName}: "${messageBody.slice(0, 80)}"`,
        url: `/leads/${leadId}`,
        tag: 'hot-lead-sms',
      }).catch(() => {})
      // Log the alert
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'sms',
        description: hotAlertBody,
        agent: 'System',
        metadata: { direction: 'outbound_alert', to_agents: ['Casey', 'Ernest'], trigger: 'hot_lead_reply_alert' },
      })
    }

    // ── Unknown number — full automation: lead, manifest, alerts, auto-reply, task ──
    if (!lead) {
      let newLeadId: string | null = null

      if (prospectMatch) {
        // Tax delinquent prospect — create enriched lead
        newLeadId = await createEnrichedLeadFromProspect(prospectMatch, from, 'tax_delinquent_inbound_sms', 'warm')
      } else {
        // Generic unknown SMS — create basic lead
        const { data: newLead } = await supabase.from('leads').insert({
          full_name: `SMS Lead (${from})`,
          phone: from,
          source: 'inbound_sms',
          station: 'intake',
          priority: 'warm',
        }).select('id').single()
        newLeadId = newLead?.id || null

        if (newLeadId) {
          ensureManifestExists(newLeadId).then(() => {
            onCommunicationEvent(newLeadId!, { type: 'inbound_sms', content: messageBody }).catch(() => {})
          }).catch(() => {})
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
          ? `🔥 TAX PROSPECT texted! ${prospectMatch.owner_1 || from}: "${messageBody.slice(0, 60)}"${unknownProspectCtx}\n${BASE_URL}/leads/${newLeadId}`
          : `📩 New text from unknown number ${from}: "${messageBody.slice(0, 80)}" ${BASE_URL}/leads/${newLeadId}`
        await Promise.allSettled([
          twilioClient.messages.create({ body: smsAlert, from: TWILIO_PHONE, to: CASEY_PHONE }),
          twilioClient.messages.create({ body: smsAlert, from: TWILIO_PHONE, to: ERNEST_PHONE }),
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
              ? `Tax prospect texted: ${prospectMatch.owner_1 || from}`
              : `New text from unknown: ${from}`,
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

      // Auto-reply to unknown sender (delayed 30-60s, with dedup)
      const optedOut = await isOptedOut(from)
      const { allowed: phoneOk } = phoneRateLimit(from)
      if (!optedOut && phoneOk) {
        const replyFrom = to || TWILIO_PHONE
        const autoReplyMsg = `Thanks for reaching out to Saving KC Homebuyers! Are you looking to sell a property? Reply YES and we'll call you right back.`
        const isDupe = await isDuplicateSms(from, autoReplyMsg)
        if (!isDupe) {
          sendDelayed(async () => {
            await twilioClient.messages.create({ body: autoReplyMsg, from: replyFrom, to: from })
            await logSmsSend(from, autoReplyMsg, replyFrom, newLeadId || undefined)
            if (newLeadId) {
              await supabase.from('lead_activities').insert({
                lead_id: newLeadId,
                activity_type: 'sms',
                description: autoReplyMsg,
                agent: 'System',
                metadata: { direction: 'outbound', from: replyFrom, to: from, trigger: 'unknown_sms_auto_reply' }
              })
            }
          }, 30, 60)
        }
      }
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
