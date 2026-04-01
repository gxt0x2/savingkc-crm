/**
 * Build a rich, context-aware prompt from manifest data for Ari briefings.
 * Output tone: casual, direct, like a smart friend giving you the rundown
 * before you pick up the phone. NOT corporate. NOT robotic.
 */

import type { ManifestV2 } from './manifest-builder'

export interface BriefingResult {
  situation: string
  motivation: string
  strategy: string
}

export function buildManifestBriefingPrompt(manifest: ManifestV2): string {
  const sections: string[] = []

  // ── Owner info ──
  const o = manifest.owner
  sections.push(`OWNER: ${o.fullName}`)
  if (o.phones?.length) sections.push(`Phone: ${o.phones.join(', ')}`)
  if (o.outOfState) sections.push('Lives out of state (absentee owner)')
  if (o.deceased) sections.push('Owner is DECEASED — likely inherited property')
  if (o.personalityType) sections.push(`Personality: ${o.personalityType}`)
  if (o.coOwners?.length) sections.push(`Co-owners: ${o.coOwners.join(', ')}`)
  if (o.bestTimeToContact) sections.push(`Best time to reach: ${o.bestTimeToContact}`)

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
    if (dw.exterior) sections.push(`Exterior: ${dw.exterior}`)
  }
  if (p.vacant) sections.push('Property is VACANT')
  if (p.occupancy) sections.push(`Occupancy: ${p.occupancy}`)

  // Assessment & taxes
  const a = p.assessment
  if (a) {
    if (a.appraisedTotal || a.totalValue) {
      sections.push(`\nASSESSMENT: Appraised at $${(a.appraisedTotal || a.totalValue || 0).toLocaleString()}`)
    }
    if (a.landValue) sections.push(`  Land: $${a.landValue.toLocaleString()}`)
    if (a.improvementValue) sections.push(`  Improvements: $${a.improvementValue.toLocaleString()}`)
  }
  const tc = p.taxCollector
  if (tc) {
    if (tc.totalOwed) sections.push(`TAX OWED: $${tc.totalOwed.toLocaleString()}`)
    if (tc.delinquentAmount) sections.push(`Delinquent: $${tc.delinquentAmount.toLocaleString()}`)
    if (tc.yearsDelinquent) sections.push(`Years delinquent: ${tc.yearsDelinquent}`)
    if (tc.taxStatus) sections.push(`Tax status: ${tc.taxStatus}`)
  }

  // Condition
  const cond = p.condition
  if (cond?.overall) sections.push(`\nCONDITION: ${cond.overall}`)
  if (cond?.roof) sections.push(`  Roof: ${cond.roof}`)
  if (cond?.hvac) sections.push(`  HVAC: ${cond.hvac}`)
  if (cond?.foundation) sections.push(`  Foundation: ${cond.foundation}`)
  if (cond?.notes) sections.push(`  Notes: ${cond.notes}`)

  // ── Situation ──
  const sit = manifest.situation
  if (sit.type?.length) sections.push(`\nSITUATION TAGS: ${sit.type.join(', ')}`)
  if (sit.summary) sections.push(`Summary: ${sit.summary}`)

  // Motivation
  const mot = sit.motivation
  if (mot) {
    if (mot.primary) sections.push(`Primary motivation: ${mot.primary}`)
    if (mot.urgencyLevel) sections.push(`Urgency: ${mot.urgencyLevel}`)
    if (mot.score !== undefined && mot.score !== null) sections.push(`Motivation score: ${mot.score}/10`)
    if (mot.signals?.length) sections.push(`Signals: ${mot.signals.join('; ')}`)
  }

  // Timeline
  const tl = sit.timeline
  if (tl) {
    if (tl.urgency) sections.push(`Timeline urgency: ${tl.urgency}`)
    if (tl.targetCloseDate) sections.push(`Target close: ${tl.targetCloseDate}`)
    if (tl.hardDeadline) sections.push(`HARD DEADLINE: ${tl.deadlineReason || 'yes'}`)
    if (tl.flexibility) sections.push(`Flexibility: ${tl.flexibility}`)
  }

  // Price expectations
  const pe = sit.priceExpectations
  if (pe) {
    if (pe.sellerAsking) sections.push(`Seller asking: $${pe.sellerAsking.toLocaleString()}`)
    if (pe.sellerFloor) sections.push(`Seller floor: $${pe.sellerFloor.toLocaleString()}`)
    if (pe.priceFlexibility) sections.push(`Price flexibility: ${pe.priceFlexibility}`)
    if (pe.priceAnchor) sections.push(`Price anchor: ${pe.priceAnchor}`)
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
    if (fin.offer_amount) finParts.push(`Our offer: $${fin.offer_amount.toLocaleString()}`)
    if (fin.assignment_fee) finParts.push(`Assignment fee: $${fin.assignment_fee.toLocaleString()}`)
    if (finParts.length) sections.push(`\nFINANCIALS: ${finParts.join(' | ')}`)
  }

  // ── Deal ──
  const deal = manifest.deal
  if (deal?.status && deal.status !== 'none') {
    sections.push(`\nDEAL STATUS: ${deal.status}`)
    if (deal.contractPrice) sections.push(`Contract: $${deal.contractPrice.toLocaleString()}`)
    if (deal.assignmentFee) sections.push(`Assignment: $${deal.assignmentFee.toLocaleString()}`)
  }

  // ── Flags ──
  const flags = manifest.flags
  if (flags.redFlags?.length) sections.push(`\nRED FLAGS: ${flags.redFlags.join(', ')}`)
  if (flags.opportunityFlags?.length) sections.push(`OPPORTUNITIES: ${flags.opportunityFlags.join(', ')}`)

  // ── Booking ──
  const book = manifest.booking
  if (book?.scheduledDate) {
    sections.push(`\nBOOKING: ${book.type || 'appointment'} on ${book.scheduledDate} at ${book.scheduledTime || 'TBD'}`)
  }

  // ── Agent notes ──
  if (manifest.agentNotes?.length) {
    const recentNotes = manifest.agentNotes.slice(-5)
    sections.push('\nAGENT NOTES (most recent):')
    for (const n of recentNotes) {
      sections.push(`  [${n.author}, ${n.source}]: ${n.content}`)
    }
  }

  // ── Communication history ──
  if (manifest.communications?.transcripts?.length) {
    const recent = manifest.communications.transcripts.slice(-3)
    sections.push(`\nCALL HISTORY: ${manifest.communications.transcripts.length} calls logged`)
    for (const t of recent) {
      const summary = t.aiSummary || t.agentNotes || `${t.duration}s call with ${t.agent}`
      sections.push(`  [${t.date}] ${summary}`)
    }
  }

  // ── Notes ──
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
    if (ari.sellerProfile.emotionalDrivers?.length) sections.push(`Emotional drivers: ${ari.sellerProfile.emotionalDrivers.join(', ')}`)
  }
  if (ari?.dealIntelligence?.confidenceScore !== undefined) {
    sections.push(`Deal confidence: ${ari.dealIntelligence.confidenceScore}%`)
  }
  if (ari?.dealIntelligence?.keyLeverage?.length) {
    sections.push(`Key leverage: ${ari.dealIntelligence.keyLeverage.join('; ')}`)
  }

  // ── Pipeline ──
  sections.push(`\nSTATION: ${manifest.currentStation} | PRIORITY: ${manifest.priority}${manifest.tier ? ` | TIER: ${manifest.tier}` : ''}`)
  if (manifest.qualificationScore) sections.push(`Qualification score: ${manifest.qualificationScore}/100`)

  const dataBlock = sections.join('\n')

  return `You are Ari, the AI brain behind Saving KC Homebuyers — a real estate wholesaling company in Kansas City. You brief the agents (Ernest and Casey) before they talk to sellers.

Your tone: Talk like a sharp friend who knows real estate. Keep it casual but specific. Use actual numbers. No corporate speak, no fluff, no bullet points. Write in flowing sentences like you're giving a quick verbal rundown. Reference specific details from the data — year built, tax amounts, condition, what the seller said. If you don't have data on something, skip it. Never make up numbers.

Here's everything we know about this lead:

${dataBlock}

Respond in JSON with exactly three fields:
{
  "situation": "2-4 sentences. Paint the picture — who is this person, what's going on with the property, what's their deal. Mention specific numbers (tax owed, year built, sqft, assessment value) when available. If they're out of state, tax delinquent, inherited, vacant — weave it in naturally.",
  "motivation": "2-3 sentences. How urgent is this? What's driving them? Are they price-sensitive or speed-sensitive? If we have a motivation score or signals, reference them. Be honest about unknowns — 'We don't have a read on their urgency yet' is fine.",
  "strategy": "2-3 sentences. Concrete tactical advice. Reference specific leverage points from the data. Suggest an opening approach, mention if we should lead with speed/cash/convenience. If we have pricing data, suggest a rough offer range. If there's an upcoming appointment, prep for it."
}

Important:
- Use the owner's first name naturally in conversation
- Mention the property age and condition when relevant (e.g., "roof is ~22 years old" based on year built)
- If tax delinquent, mention the dollar amount
- If there's an appraised value, reference it to frame the deal
- Sound like you actually read the file, not like you're filling in a template`
}
