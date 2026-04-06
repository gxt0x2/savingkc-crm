/**
 * Ari Signal Generator for Hot Opportunities
 *
 * Uses Claude Haiku via Anthropic API (per AI model rules — Anthropic ecosystem only)
 * Generates signal narrative + next move directive for top-7 hot deals.
 */

import type { ManifestV2 } from '../manifest-builder'
import type { HotScoreResult } from './scoring'

interface AriSignalResult {
  signal: string
  nextMove: string
}

/**
 * Generate hot signal + next move for a lead.
 * Calls Claude Haiku for narrative generation.
 * Falls back to rule-based generation if API unavailable.
 */
export async function generateHotSignal(
  manifest: ManifestV2,
  hotScore: HotScoreResult,
): Promise<AriSignalResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return generateRuleBasedSignal(manifest, hotScore)
  }

  try {
    const context = buildPromptContext(manifest, hotScore)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `You are Ari, an AI assistant for a real estate wholesaler in Kansas City. Given this lead data and score breakdown, write exactly two things:

SIGNAL: 1-2 sentences on why this deal is hot RIGHT NOW. Be specific, reference actual data points. No generic statements.

NEXT_MOVE: One specific directive tied to the current pipeline stage. Start with a verb. Include who should do it if there's an assigned agent.

Lead data:
${context}

Respond in this exact format:
SIGNAL: [your signal]
NEXT_MOVE: [your directive]`,
        }],
      }),
    })

    if (!response.ok) {
      console.error('[ari-signal] API error:', response.status)
      return generateRuleBasedSignal(manifest, hotScore)
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    const signalMatch = text.match(/SIGNAL:\s*([\s\S]+?)(?:\n|NEXT_MOVE:)/)
    const nextMoveMatch = text.match(/NEXT_MOVE:\s*([\s\S]+?)$/)

    return {
      signal: signalMatch?.[1]?.trim() || generateRuleBasedSignal(manifest, hotScore).signal,
      nextMove: nextMoveMatch?.[1]?.trim() || generateRuleBasedSignal(manifest, hotScore).nextMove,
    }
  } catch (err) {
    console.error('[ari-signal] Generation failed:', err)
    return generateRuleBasedSignal(manifest, hotScore)
  }
}

function buildPromptContext(manifest: ManifestV2, score: HotScoreResult): string {
  const parts: string[] = []

  parts.push(`Property: ${manifest.property?.address || 'Unknown'}`)
  parts.push(`Seller: ${manifest.owner?.fullName || 'Unknown'}`)
  parts.push(`Stage: ${manifest.currentStation}`)
  parts.push(`Score: ${score.composite}/100 (Engagement: ${score.factors.engagement}/35, Velocity: ${score.factors.velocity}/25, Deal Quality: ${score.factors.dealQuality}/25, Time Pressure: ${score.factors.timePressure}/15)`)
  parts.push(`Tier: ${score.tierLabel}${score.tierCapped ? ' (capped — missing data)' : ''}`)

  if (manifest.financials?.arv) parts.push(`ARV: $${manifest.financials.arv.toLocaleString()}`)
  if (manifest.financials?.offer_amount) parts.push(`Offer: $${manifest.financials.offer_amount.toLocaleString()}`)
  if (manifest.financials?.spread) parts.push(`Spread: $${manifest.financials.spread.toLocaleString()}`)

  const timeline = manifest.situation?.timeline
  if (timeline?.sellerDeadline) parts.push(`Deadline: ${timeline.sellerDeadline}${timeline.sellerDeadlineVerified ? ' (verified)' : ''}`)
  if (timeline?.competingOffersPresent) parts.push(`Competing offers: ${timeline.competingOfferSpecificity || 'yes'}`)
  if (timeline?.lifeEventType) parts.push(`Life event: ${timeline.lifeEventType} (${timeline.lifeEventStage || 'unknown stage'})`)

  const comms = manifest.communications
  if (comms?.lastSellerContactDate) parts.push(`Last seller contact: ${comms.lastSellerContactDate}`)
  if (comms?.responsePending) parts.push('Response pending from seller')
  if (comms?.cadenceGapDetected) parts.push('Cadence gap detected')

  if (manifest.situation?.motivation?.primary) parts.push(`Motivation: ${manifest.situation.motivation.primary}`)
  if (manifest.assignedAgent) parts.push(`Agent: ${manifest.assignedAgent}`)

  if (score.missingFields.length > 0) parts.push(`Missing data: ${score.missingFields.join(', ')}`)

  return parts.join('\n')
}

/**
 * Rule-based fallback: construct signal from scoring factors when API is unavailable.
 */
function generateRuleBasedSignal(manifest: ManifestV2, score: HotScoreResult): AriSignalResult {
  const parts: string[] = []
  const station = manifest.currentStation
  const financials = manifest.financials
  const comms = manifest.communications
  const timeline = manifest.situation?.timeline
  const priority = (manifest as any).priority

  // Lead identity context
  const sellerName = manifest.owner?.firstName || manifest.owner?.fullName?.split(' ')[0]

  const isFavorite = (manifest as any).is_favorite

  // Signal — build a narrative about WHY this lead matters right now
  if (isFavorite) {
    parts.push('Starred as a priority lead')
  }
  if (priority === 'hot') {
    parts.push('marked high-priority')
  } else if (priority === 'warm') {
    parts.push('warm lead with active interest')
  }

  if (['appointment', 'appt_set'].includes(station)) {
    parts.push('appointment is set — seller agreed to talk')
  } else if (['discovery', 'qualified'].includes(station)) {
    parts.push('in active discovery — gathering deal details')
  } else if (['offer', 'offer_made', 'valuation'].includes(station)) {
    parts.push('approaching offer stage')
  } else if (['negotiations'].includes(station)) {
    parts.push('in active negotiations')
  } else if (['contract', 'under_contract'].includes(station)) {
    parts.push('under contract — heading to close')
  }

  // Touchpoint context
  const touchpoints = comms?.totalTouchpoints
  if (touchpoints && touchpoints >= 5) {
    parts.push(`${touchpoints} touchpoints logged`)
  }

  if (score.factors.engagement >= 25) {
    const daysSince = score.rawInputs?.engagement?.daysSinceContact
    if (daysSince !== null && daysSince !== undefined && daysSince <= 2) {
      parts.push(`seller was in contact within ${daysSince === 0 ? 'the last 24hrs' : daysSince + ' days'}`)
    } else {
      parts.push('seller is actively engaged')
    }
  } else if (comms?.outreachAttemptsSinceLastResponse && comms.outreachAttemptsSinceLastResponse >= 3) {
    parts.push(`${comms.outreachAttemptsSinceLastResponse} outreach attempts without response`)
  }

  if (financials?.arv) {
    const arvK = Math.round(financials.arv / 1000)
    if (financials.repair_estimate) {
      const repairK = Math.round(financials.repair_estimate / 1000)
      parts.push(`ARV $${arvK}k with $${repairK}k in repairs`)
    } else {
      parts.push(`ARV $${arvK}k`)
    }
  }

  if (score.factors.dealQuality >= 18 && financials?.spread) {
    parts.push(`$${Math.round(financials.spread / 1000)}k spread`)
  }

  if (score.factors.timePressure >= 11) {
    if (timeline?.sellerDeadline) {
      parts.push(`deadline approaching (${timeline.sellerDeadline})`)
    } else if (timeline?.competingOffersPresent) {
      parts.push('competing offers in play')
    } else if (timeline?.foreclosureWindowDays) {
      parts.push(`foreclosure in ${timeline.foreclosureWindowDays} days`)
    }
  }

  if (manifest.situation?.motivation?.score && manifest.situation.motivation.score >= 7) {
    parts.push('high motivation detected')
  }

  if (manifest.owner?.deceased) {
    parts.push('deceased owner — potential probate deal')
  }

  if (manifest.property?.taxCollector?.delinquentAmount) {
    const taxK = Math.round(manifest.property.taxCollector.delinquentAmount / 1000)
    if (taxK >= 1) parts.push(`$${taxK}k in back taxes`)
  }

  if (comms?.cadenceGapDetected) {
    parts.push('but cadence gap detected — needs follow-up')
  }

  const signal = parts.length > 0
    ? parts.join(', ') + '.'
    : `Score ${score.composite}/100. Needs more data to assess opportunity.`

  // Next move — specific, actionable directive
  let nextMove: string
  const missingData = score.missingFields

  if (['intake', 'new'].includes(station)) {
    if (sellerName) {
      nextMove = `Call ${sellerName} to introduce yourself and gauge motivation.`
    } else {
      nextMove = 'Make initial contact — call or send intro text.'
    }
  } else if (['contacted', 'qualifying'].includes(station)) {
    const attempts = comms?.outreachAttemptsSinceLastResponse || 0
    const agent = manifest.assignedAgent
    if (attempts >= 3) {
      nextMove = agent
        ? `${agent}: try a different approach — text or different time of day. ${attempts} calls without pickup.`
        : `Try a different approach — text or different time of day. ${attempts} calls without pickup.`
    } else if (missingData.includes('ARV')) {
      nextMove = agent
        ? `${agent}: get the property address confirmed and pull comps for ARV.`
        : 'Get the property address confirmed and pull comps for ARV.'
    } else {
      nextMove = agent
        ? `${agent}: schedule a discovery call to understand their situation and timeline.`
        : 'Schedule a discovery call to understand their situation and timeline.'
    }
  } else if (['appointment', 'appt_set'].includes(station)) {
    nextMove = 'Prepare for appointment — review property details and pull comps before the call.'
  } else if (['discovery'].includes(station)) {
    if (!financials?.arv) {
      nextMove = 'Pull comps and determine ARV — need numbers to make an offer.'
    } else if (!financials?.repair_estimate) {
      nextMove = 'Get repair estimate — schedule walkthrough or use desktop estimate.'
    } else {
      nextMove = 'Run the numbers and prepare offer. All key data points are in.'
    }
  } else if (['valuation', 'research'].includes(station)) {
    nextMove = financials?.arv
      ? 'Finalize offer amount based on comps and repair estimate.'
      : 'Complete valuation — pull comps and calculate max offer.'
  } else if (['offer', 'offer_made'].includes(station)) {
    nextMove = financials?.offer_amount
      ? `Follow up on the $${Math.round((financials.offer_amount || 0) / 1000)}k offer — ask for their decision timeline.`
      : 'Calculate and submit your offer.'
  } else if (['negotiations'].includes(station)) {
    nextMove = 'Address remaining objections and push for a signed contract.'
  } else if (['contract', 'under_contract'].includes(station)) {
    nextMove = 'Schedule inspection and begin marketing to buyers.'
  } else {
    nextMove = 'Review lead status and determine next action.'
  }

  return { signal: signal.charAt(0).toUpperCase() + signal.slice(1), nextMove }
}

/**
 * Check if a signal is stale (>4 hours old).
 */
export function isSignalStale(manifest: ManifestV2): boolean {
  const generatedAt = manifest.ariIntelligence?.hotSignalGeneratedAt
  if (!generatedAt) return true
  const ageMs = Date.now() - new Date(generatedAt).getTime()
  return ageMs > 4 * 60 * 60 * 1000
}
