/**
 * Build a rich, context-aware prompt from manifest data + live activities for Ari briefings.
 * Output tone: casual, direct, like a smart friend giving you the rundown
 * before you pick up the phone. NOT corporate. NOT robotic.
 */

import type { ManifestV2 } from './manifest-builder'

export interface BriefingResult {
  situation: string
  motivation: string
  strategy: string
}

/** Activity row shape from lead_activities table */
export interface ActivityRow {
  id: string
  lead_id: string | null
  activity_type: string
  description: string
  agent: string | null
  metadata: Record<string, any> | null
  created_at: string
}

export function buildManifestBriefingPrompt(
  manifest: ManifestV2,
  activities?: ActivityRow[],
): string {
  const sections: string[] = []

  // ── Owner info ──
  const o = manifest.owner
  sections.push(`OWNER: ${o.fullName}`)
  if (o.phones?.length) sections.push(`Phone: ${o.phones.join(', ')}`)
  if (o.emails?.length) sections.push(`Email: ${o.emails.join(', ')}`)
  if (o.contactPreference) sections.push(`Prefers: ${o.contactPreference}`)
  if (o.outOfState) sections.push('Lives out of state (absentee owner)')
  if (o.deceased) sections.push('Owner is DECEASED — likely inherited property')
  if (o.personalityType) sections.push(`Personality: ${o.personalityType}`)
  if (o.coOwners?.length) sections.push(`Co-owners: ${o.coOwners.join(', ')}`)
  if (o.bestTimeToContact) sections.push(`Best time to reach: ${o.bestTimeToContact}`)
  if (o.relationshipToProperty) sections.push(`Relationship to property: ${o.relationshipToProperty}`)

  // ── Lead source ──
  if (manifest.source) sections.push(`Lead source: ${manifest.source}`)

  // ── Property ──
  const p = manifest.property
  if (p.address) sections.push(`\nPROPERTY: ${p.address}`)
  const dw = p.dwelling
  if (dw) {
    const parts: string[] = []
    if (dw.bedrooms) parts.push(`${dw.bedrooms}bd`)
    if (dw.bathrooms) parts.push(`${dw.bathrooms}ba`)
    if (dw.sqft) parts.push(`${dw.sqft.toLocaleString()} sqft`)
    if (dw.yearBuilt) parts.push(`built ${dw.yearBuilt}`)
    if (dw.propertyType) parts.push(dw.propertyType)
    if (parts.length) sections.push(`Dwelling: ${parts.join(', ')}`)

    if (dw.roofType) sections.push(`Roof: ${dw.roofType}`)
    if (dw.hvac) sections.push(`HVAC: ${dw.hvac}`)
    if (dw.basement) sections.push(`Basement: ${dw.basement}`)
    if (dw.finishedBasementSqft) sections.push(`Finished basement: ${dw.finishedBasementSqft} sqft`)
    if (dw.exterior) sections.push(`Exterior: ${dw.exterior}`)
    if (dw.garageSize) sections.push(`Garage: ${dw.garageSize}-car`)
  }
  if (p.vacant) sections.push('Property is VACANT')
  if (p.occupancy) sections.push(`Occupancy: ${p.occupancy}`)

  // Assessment & taxes
  const a = p.assessment
  if (a) {
    if (a.appraisedTotal || a.totalValue) {
      sections.push(`\nASSESSMENT: Appraised at $${(a.appraisedTotal || a.totalValue || 0).toLocaleString()}`)
    }
    if (a.assessedTotal && a.assessedTotal !== a.appraisedTotal) {
      sections.push(`  Assessed: $${a.assessedTotal.toLocaleString()}`)
    }
    if (a.landValue) sections.push(`  Land: $${a.landValue.toLocaleString()}`)
    if (a.improvementValue) sections.push(`  Improvements: $${a.improvementValue.toLocaleString()}`)
    if (a.assessmentYear) sections.push(`  Assessment year: ${a.assessmentYear}`)
  }
  const tc = p.taxCollector
  if (tc) {
    if (tc.totalOwed) sections.push(`TAX OWED: $${tc.totalOwed.toLocaleString()}`)
    if (tc.delinquentAmount) sections.push(`Delinquent: $${tc.delinquentAmount.toLocaleString()}`)
    if (tc.yearsDelinquent) sections.push(`Years delinquent: ${tc.yearsDelinquent}`)
    if (tc.delinquentYears) sections.push(`Delinquent years: ${tc.delinquentYears}`)
    if (tc.lastPaymentDate) sections.push(`Last tax payment: ${tc.lastPaymentDate}`)
    if (tc.taxStatus) sections.push(`Tax status: ${tc.taxStatus}`)
    if (tc.currentAmountDue) sections.push(`Current year due: $${tc.currentAmountDue.toLocaleString()}`)
  }

  // Condition
  const cond = p.condition
  if (cond?.overall) sections.push(`\nCONDITION: ${cond.overall}`)
  if (cond?.roof) sections.push(`  Roof: ${cond.roof}`)
  if (cond?.hvac) sections.push(`  HVAC: ${cond.hvac}`)
  if (cond?.foundation) sections.push(`  Foundation: ${cond.foundation}`)
  if (cond?.electrical) sections.push(`  Electrical: ${cond.electrical}`)
  if (cond?.plumbing) sections.push(`  Plumbing: ${cond.plumbing}`)
  if (cond?.notes) sections.push(`  Notes: ${cond.notes}`)

  // ── Situation ──
  const sit = manifest.situation
  if (sit.type?.length) sections.push(`\nSITUATION TAGS: ${sit.type.join(', ')}`)
  if (sit.summary) sections.push(`Summary: ${sit.summary}`)

  // Motivation
  const mot = sit.motivation
  if (mot) {
    if (mot.primary) sections.push(`Primary motivation: ${mot.primary}`)
    if (mot.secondary?.length) sections.push(`Secondary motivations: ${mot.secondary.join(', ')}`)
    if (mot.urgencyLevel) sections.push(`Urgency: ${mot.urgencyLevel}`)
    if (mot.score !== undefined && mot.score !== null) sections.push(`Motivation score: ${mot.score}/10`)
    if (mot.signals?.length) sections.push(`Signals: ${mot.signals.join('; ')}`)
  }

  // Timeline
  const tl = sit.timeline
  if (tl) {
    if (tl.urgency) sections.push(`Timeline urgency: ${tl.urgency}`)
    if (tl.preferredClosing) sections.push(`Preferred closing: ${tl.preferredClosing}`)
    if (tl.targetCloseDate) sections.push(`Target close: ${tl.targetCloseDate}`)
    if (tl.hardDeadline) sections.push(`HARD DEADLINE: ${tl.deadlineReason || 'yes'}`)
    if (tl.flexibility) sections.push(`Flexibility: ${tl.flexibility}`)
    if (tl.constraints?.length) sections.push(`Constraints: ${tl.constraints.join('; ')}`)
  }

  // Price expectations
  const pe = sit.priceExpectations
  if (pe) {
    if (pe.sellerAsking || pe.askingPrice) sections.push(`Seller asking: $${(pe.sellerAsking || pe.askingPrice || 0).toLocaleString()}`)
    if (pe.sellerFloor || pe.minimumAcceptable) sections.push(`Seller floor: $${(pe.sellerFloor || pe.minimumAcceptable || 0).toLocaleString()}`)
    if (pe.priceFlexibility) sections.push(`Price flexibility: ${pe.priceFlexibility}`)
    if (pe.priceAnchor) sections.push(`Price anchor: ${pe.priceAnchor}`)
    if (pe.basis) sections.push(`Price basis: ${pe.basis}`)
  }

  if (sit.objections?.length) sections.push(`Objections: ${sit.objections.join('; ')}`)
  if (sit.blockers?.length) sections.push(`Blockers: ${sit.blockers.join('; ')}`)

  // ── Financials ──
  const fin = manifest.financials
  if (fin) {
    const finParts: string[] = []
    if (fin.arv) finParts.push(`ARV: $${fin.arv.toLocaleString()}`)
    if (fin.as_is_value) finParts.push(`As-is: $${fin.as_is_value.toLocaleString()}`)
    if (fin.repair_estimate) finParts.push(`Repairs: $${fin.repair_estimate.toLocaleString()}`)
    if (fin.mortgage_balance) finParts.push(`Mortgage: $${fin.mortgage_balance.toLocaleString()}`)
    if (fin.back_taxes) finParts.push(`Back taxes: $${fin.back_taxes.toLocaleString()}`)
    if (fin.liens_amount) finParts.push(`Liens: $${fin.liens_amount.toLocaleString()}`)
    if (fin.equity) finParts.push(`Equity: $${fin.equity.toLocaleString()}`)
    if (fin.total_debt) finParts.push(`Total debt: $${fin.total_debt.toLocaleString()}`)
    if (fin.offer_amount) finParts.push(`Our offer: $${fin.offer_amount.toLocaleString()}`)
    if (fin.assignment_fee) finParts.push(`Assignment fee: $${fin.assignment_fee.toLocaleString()}`)
    if (finParts.length) sections.push(`\nFINANCIALS: ${finParts.join(' | ')}`)
  }

  // ── Deal ──
  const deal = manifest.deal
  if (deal) {
    if (deal.status && deal.status !== 'none') {
      sections.push(`\nDEAL STATUS: ${deal.status}`)
      if (deal.contractPrice) sections.push(`Contract: $${deal.contractPrice.toLocaleString()}`)
      if (deal.assignmentFee) sections.push(`Assignment: $${deal.assignmentFee.toLocaleString()}`)
    }
    if (deal.offerRange) {
      sections.push(`Our offer range: $${deal.offerRange.min.toLocaleString()} - $${deal.offerRange.max.toLocaleString()}`)
    }
  }

  // ── Flags ──
  const flags = manifest.flags
  if (flags.redFlags?.length) sections.push(`\nRED FLAGS: ${flags.redFlags.join(', ')}`)
  if (flags.opportunityFlags?.length) sections.push(`OPPORTUNITIES: ${flags.opportunityFlags.join(', ')}`)

  // ── Contacts (attorneys, family, tenants) ──
  if (manifest.contacts?.length) {
    sections.push('\nADDITIONAL CONTACTS:')
    for (const c of manifest.contacts) {
      const contactParts = [c.name, c.role]
      if (c.phone) contactParts.push(c.phone)
      if (c.notes) contactParts.push(`(${c.notes})`)
      sections.push(`  ${contactParts.join(' — ')}`)
    }
  }

  // ── Booking ──
  const book = manifest.booking
  if (book?.scheduledDate) {
    sections.push(`\nBOOKING: ${book.type || 'appointment'} on ${book.scheduledDate} at ${book.scheduledTime || 'TBD'}`)
  }

  // ── Pipeline stage progression ──
  if (manifest.pipeline) {
    const completedStages: string[] = []
    const inProgressStages: string[] = []
    const stageNames = ['intake', 'qualifying', 'discovery', 'research', 'valuation', 'offer', 'negotiations', 'contract', 'inspection', 'closing_prep', 'closing', 'closed'] as const
    for (const s of stageNames) {
      const stage = (manifest.pipeline as any)[s]
      if (stage?.status === 'completed') completedStages.push(s)
      else if (stage?.status === 'in_progress') inProgressStages.push(s)
    }
    if (completedStages.length || inProgressStages.length) {
      sections.push(`\nPIPELINE PROGRESS:`)
      if (completedStages.length) sections.push(`  Completed: ${completedStages.join(' → ')}`)
      if (inProgressStages.length) sections.push(`  In progress: ${inProgressStages.join(', ')}`)
    }
    if (manifest.pipeline.appointment?.dateTime) {
      sections.push(`  Next appointment: ${manifest.pipeline.appointment.dateTime}${manifest.pipeline.appointment.type ? ` (${manifest.pipeline.appointment.type})` : ''}`)
    }
  }

  // ── Agent notes (from manifest) ──
  if (manifest.agentNotes?.length) {
    const recentNotes = manifest.agentNotes.slice(-5)
    sections.push('\nAGENT NOTES (most recent):')
    for (const n of recentNotes) {
      sections.push(`  [${n.author}, ${n.source}]: ${n.content}`)
    }
  }

  // ── Communication history (from manifest transcripts — Mojo call analysis) ──
  if (manifest.communications?.transcripts?.length) {
    const allTranscripts = manifest.communications.transcripts
    const recent = allTranscripts.slice(-5)
    sections.push(`\nCALL TRANSCRIPTS: ${allTranscripts.length} calls logged, showing last ${recent.length}`)

    for (const t of recent) {
      const header = `[${t.date}] ${t.duration}s call with ${t.agent}`
      sections.push(`\n  ${header}`)

      // AI summary
      if (t.aiSummary) {
        sections.push(`  Summary: ${t.aiSummary}`)
      }

      // Agent notes from the call
      if (t.agentNotes) {
        sections.push(`  Agent notes: ${t.agentNotes}`)
      }

      // Extracted intelligence from call analysis
      const ex = t.extractedData
      if (ex) {
        if (ex.motivationScore !== undefined && ex.motivationScore !== null) {
          sections.push(`  Call motivation score: ${ex.motivationScore}/10`)
        }
        if (ex.sentiment) sections.push(`  Sentiment: ${ex.sentiment}`)
        if (ex.rapportLevel) sections.push(`  Rapport: ${ex.rapportLevel}`)
        if (ex.talkRatio !== undefined && ex.talkRatio !== null) {
          sections.push(`  Talk ratio (agent/seller): ${Math.round(ex.talkRatio * 100)}%/${Math.round((1 - ex.talkRatio) * 100)}%`)
        }

        // Verbatim quotes from the seller — these are gold for briefings
        if (ex.verbatimQuotes?.length) {
          sections.push(`  SELLER QUOTES:`)
          for (const q of ex.verbatimQuotes.slice(0, 5)) {
            sections.push(`    "${q}"`)
          }
        }

        // Objections they raised
        if (ex.objectionResponses?.length) {
          sections.push(`  OBJECTIONS RAISED:`)
          for (const obj of ex.objectionResponses.slice(0, 3)) {
            sections.push(`    - ${obj}`)
          }
        }

        // Concession signals — signs they're ready to deal
        if (ex.concessionSignals?.length) {
          sections.push(`  CONCESSION SIGNALS:`)
          for (const sig of ex.concessionSignals.slice(0, 3)) {
            sections.push(`    + ${sig}`)
          }
        }
      }

      // Full transcript (truncated — include enough for context)
      if (t.fullTranscript) {
        const truncated = t.fullTranscript.length > 2000
          ? t.fullTranscript.slice(0, 2000) + '... [truncated]'
          : t.fullTranscript
        sections.push(`  FULL TRANSCRIPT:`)
        sections.push(`  ${truncated}`)
      }
    }
  }

  // ── Notes (from manifest) ──
  if (manifest.notes?.length) {
    const recentNotes = manifest.notes.slice(-3)
    sections.push('\nNOTES:')
    for (const n of recentNotes) {
      sections.push(`  [${n.author}]: ${n.content}`)
    }
  }

  // ── Existing AI intelligence ──
  const ari = manifest.ariIntelligence
  if (ari?.sellerProfile?.personalityType) {
    sections.push(`\nSELLER PROFILE: ${ari.sellerProfile.personalityType}`)
    if (ari.sellerProfile.communicationStyle) sections.push(`Communication: ${ari.sellerProfile.communicationStyle}`)
    if (ari.sellerProfile.decisionStyle) sections.push(`Decision style: ${ari.sellerProfile.decisionStyle}`)
    if (ari.sellerProfile.emotionalDrivers?.length) sections.push(`Emotional drivers: ${ari.sellerProfile.emotionalDrivers.join(', ')}`)
  }
  if (ari?.dealIntelligence?.confidenceScore !== undefined) {
    sections.push(`Deal confidence: ${ari.dealIntelligence.confidenceScore}%`)
  }
  if (ari?.dealIntelligence?.keyLeverage?.length) {
    sections.push(`Key leverage: ${ari.dealIntelligence.keyLeverage.join('; ')}`)
  }
  if (ari?.recommendedActions?.length) {
    sections.push('Previous recommended actions:')
    for (const a of ari.recommendedActions) {
      sections.push(`  - ${a.action}${a.reason ? ` (${a.reason})` : ''}`)
    }
  }

  // ── Pipeline meta ──
  sections.push(`\nSTATION: ${manifest.currentStation} | PRIORITY: ${manifest.priority}${manifest.tier ? ` | TIER: ${manifest.tier}` : ''}`)
  if (manifest.qualificationScore) sections.push(`Qualification score: ${manifest.qualificationScore}/100`)

  // ── Data freshness ──
  if (manifest.lastUpdated) {
    const daysSinceUpdate = Math.floor((Date.now() - new Date(manifest.lastUpdated).getTime()) / 86400000)
    if (daysSinceUpdate > 3) sections.push(`Data last updated: ${daysSinceUpdate} days ago (may be stale)`)
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIVE ACTIVITY FEED — pulled from lead_activities at generation time
  // This is the real-time layer that catches everything the manifest missed
  // ═══════════════════════════════════════════════════════════════════════════════
  if (activities?.length) {
    const smsMsgs = activities.filter(a => a.activity_type === 'sms')
    const calls = activities.filter(a => a.activity_type === 'call')
    const notes = activities.filter(a => a.activity_type === 'note' || a.activity_type === 'agent_note')
    const tasks = activities.filter(a => a.activity_type === 'task')
    const statusChanges = activities.filter(a => a.activity_type === 'status_change')
    const appointments = activities.filter(a => a.activity_type === 'appointment')
    const contracts = activities.filter(a => a.activity_type === 'contract_sent')
    const ghostActivities = activities.filter(a =>
      a.activity_type === 'ghost_protocol_enrollment' ||
      a.metadata?.ghost_protocol_step !== undefined
    )
    const voicemails = activities.filter(a => a.activity_type === 'voicemail')
    const emails = activities.filter(a => a.activity_type === 'email')

    sections.push('\n═══════ LIVE ACTIVITY FEED (from CRM) ═══════')

    // SMS conversation (both directions)
    if (smsMsgs.length) {
      const recentSms = smsMsgs.slice(-15) // Last 15 messages
      sections.push(`\nSMS CONVERSATION (${smsMsgs.length} total messages, showing last ${recentSms.length}):`)
      for (const s of recentSms) {
        const dir = s.metadata?.direction === 'received' ? '← SELLER' : '→ AGENT'
        const time = new Date(s.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        const agent = s.metadata?.direction !== 'received' && s.agent ? ` (${s.agent})` : ''
        sections.push(`  [${time}] ${dir}${agent}: ${s.description?.slice(0, 200)}`)
      }
    }

    // Calls
    if (calls.length) {
      const recentCalls = calls.slice(-8)
      sections.push(`\nCALL LOG (${calls.length} total, showing last ${recentCalls.length}):`)
      for (const c of recentCalls) {
        const dir = c.metadata?.direction === 'inbound' ? '← INBOUND' : '→ OUTBOUND'
        const time = new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        const dur = c.metadata?.duration ? ` (${c.metadata.duration}s)` : ''
        const status = c.metadata?.callStatus ? ` — ${c.metadata.callStatus}` : c.metadata?.status ? ` — ${c.metadata.status}` : ''
        sections.push(`  [${time}] ${dir}${dur}${status}: ${c.description?.slice(0, 150)}`)
      }
    }

    // Emails
    if (emails.length) {
      const recentEmails = emails.slice(-5)
      sections.push(`\nEMAILS (${emails.length} total):`)
      for (const e of recentEmails) {
        const time = new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        const subj = e.metadata?.subject ? ` — "${e.metadata.subject}"` : ''
        sections.push(`  [${time}] ${e.agent || 'System'}${subj}: ${e.description?.slice(0, 150)}`)
      }
    }

    // Voicemails (recording URLs included — not yet transcribed)
    if (voicemails.length) {
      sections.push(`\nVOICEMAILS (${voicemails.length}):`)
      for (const v of voicemails.slice(-3)) {
        const time = new Date(v.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        const recording = v.metadata?.recordingUrl ? ` [has recording]` : ''
        sections.push(`  [${time}] ${v.description?.slice(0, 200)}${recording}`)
      }
    }

    // IVR recordings (inbound caller recordings — not transcribed yet)
    const ivrRecordings = activities.filter(a =>
      a.activity_type === 'call' && a.metadata?.recordingUrl
    )
    if (ivrRecordings.length) {
      sections.push(`\nINBOUND RECORDINGS (${ivrRecordings.length} calls with recordings — audio not transcribed):`)
      for (const r of ivrRecordings.slice(-3)) {
        const time = new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        sections.push(`  [${time}] ${r.description?.slice(0, 150)}`)
      }
    }

    // Notes from CRM
    if (notes.length) {
      sections.push(`\nCRM NOTES (${notes.length}):`)
      for (const n of notes.slice(-5)) {
        const time = new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric' })
        sections.push(`  [${time}, ${n.agent || 'System'}]: ${n.description?.slice(0, 200)}`)
      }
    }

    // Ghost Protocol status
    if (ghostActivities.length) {
      const latest = ghostActivities[ghostActivities.length - 1]
      const step = latest.metadata?.ghost_protocol_step || latest.metadata?.step || '?'
      const phase = latest.metadata?.phase || '?'
      const ghostStatus = latest.metadata?.status || 'active'
      sections.push(`\nGHOST PROTOCOL: Phase ${phase}, Step ${step}, Status: ${ghostStatus}`)
      sections.push(`  Last ghost activity: ${latest.description}`)
    }

    // Appointments
    if (appointments.length) {
      const latest = appointments[appointments.length - 1]
      sections.push(`\nAPPOINTMENT: ${latest.description}`)
      if (latest.metadata?.date) sections.push(`  Scheduled: ${latest.metadata.date} at ${latest.metadata.time || 'TBD'}`)
    }

    // Contract events
    if (contracts.length) {
      const latest = contracts[contracts.length - 1]
      sections.push(`\nCONTRACT: ${latest.description}`)
    }

    // Status changes (recent)
    if (statusChanges.length) {
      const recentChanges = statusChanges.slice(-3)
      sections.push(`\nSTATUS CHANGES:`)
      for (const sc of recentChanges) {
        const time = new Date(sc.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric' })
        sections.push(`  [${time}] ${sc.description}`)
      }
    }

    // Pending tasks
    const pendingTasks = tasks.filter(t => t.metadata?.status === 'pending')
    if (pendingTasks.length) {
      sections.push(`\nPENDING TASKS (${pendingTasks.length}):`)
      for (const t of pendingTasks.slice(-3)) {
        sections.push(`  - ${t.description}${t.metadata?.assigned_to ? ` (assigned: ${t.metadata.assigned_to})` : ''}`)
      }
    }

    // Activity summary stats
    const inboundSms = smsMsgs.filter(s => s.metadata?.direction === 'received').length
    const outboundSms = smsMsgs.filter(s => s.metadata?.direction === 'outbound').length
    const inboundCalls = calls.filter(c => c.metadata?.direction === 'inbound').length
    const outboundCalls = calls.filter(c => c.metadata?.direction === 'outbound').length
    sections.push(`\nACTIVITY SUMMARY: ${inboundSms} inbound SMS, ${outboundSms} outbound SMS, ${inboundCalls} inbound calls, ${outboundCalls} outbound calls, ${notes.length} notes, ${activities.length} total activities`)
  }

  const dataBlock = sections.join('\n')

  return `You are Ari, the AI brain behind Saving KC Homebuyers — a real estate wholesaling company in Kansas City. You brief the agents (Ernest and Casey) before they talk to sellers.

Your tone: Talk like a sharp friend who knows real estate. Keep it casual but specific. Use actual numbers. No corporate speak, no fluff, no bullet points. Write in flowing sentences like you're giving a quick verbal rundown. Reference specific details from the data — year built, tax amounts, condition, what the seller said. If you don't have data on something, skip it. Never make up numbers.

Here's everything we know about this lead:

${dataBlock}

Respond in JSON with exactly three fields:
{
  "situation": "2-4 sentences. Paint the picture — who is this person, what's going on with the property, what's their deal. Mention specific numbers (tax owed, year built, sqft, assessment value) when available. If they're out of state, tax delinquent, inherited, vacant — weave it in naturally. Reference their SMS messages or call history if available — what did they say? How did they respond?",
  "motivation": "2-3 sentences. How urgent is this? What's driving them? Are they price-sensitive or speed-sensitive? If we have a motivation score or signals, reference them. Look at their communication pattern — did they reply YES? Did they call in? Are they ghosting us? Be honest about unknowns — 'We don't have a read on their urgency yet' is fine.",
  "strategy": "2-3 sentences. Concrete tactical advice. Reference specific leverage points from the data. Suggest an opening approach, mention if we should lead with speed/cash/convenience. If we have pricing data, suggest a rough offer range. If there's an upcoming appointment, prep for it. If they're in Ghost Protocol, factor that in. If they have a personality type, adjust approach."
}

Important:
- Use the owner's first name naturally in conversation
- Mention the property age and condition when relevant (e.g., "roof is ~22 years old" based on year built)
- If tax delinquent, mention the dollar amount
- If there's an appraised value, reference it to frame the deal
- Reference ACTUAL SMS messages the seller sent — quote them if impactful
- If the seller called in or replied YES, that's a high-intent signal — lead with that
- If in Ghost Protocol, mention what step they're on and factor it into strategy
- Sound like you actually read the file, not like you're filling in a template`
}
