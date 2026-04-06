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

  // Signal
  if (score.factors.engagement >= 25) {
    parts.push('Seller is actively engaged')
  }
  if (score.factors.timePressure >= 11) {
    const timeline = manifest.situation?.timeline
    if (timeline?.sellerDeadline) {
      parts.push(`deadline approaching (${timeline.sellerDeadline})`)
    } else if (timeline?.competingOffersPresent) {
      parts.push('competing offers in play')
    } else if (timeline?.foreclosureWindowDays) {
      parts.push(`foreclosure in ${timeline.foreclosureWindowDays} days`)
    }
  }
  if (score.factors.dealQuality >= 18 && manifest.financials?.spread) {
    parts.push(`$${(manifest.financials.spread / 1000).toFixed(0)}k spread`)
  }
  if (score.factors.velocity >= 20) {
    parts.push('fast-moving through pipeline')
  }

  const signal = parts.length > 0
    ? parts.join(', ') + '.'
    : `Score ${score.composite}/100 — ${score.tierLabel} tier.`

  // Next move
  let nextMove: string
  const station = manifest.currentStation
  if (['intake', 'new'].includes(station)) {
    nextMove = 'Make initial contact — call or send intro text.'
  } else if (['contacted', 'qualifying'].includes(station)) {
    nextMove = 'Schedule discovery call to capture all 4 pillars.'
  } else if (['qualified', 'appt_set', 'discovery'].includes(station)) {
    nextMove = 'Complete walkthrough and pull comps for offer.'
  } else if (['valuation', 'offer', 'offer_made'].includes(station)) {
    nextMove = manifest.financials?.offer_amount
      ? 'Follow up on submitted offer — ask for decision timeline.'
      : 'Finalize offer amount and send contract.'
  } else if (['negotiations'].includes(station)) {
    nextMove = 'Push for signed contract — address remaining objections.'
  } else if (['contract', 'under_contract'].includes(station)) {
    nextMove = 'Coordinate inspection and begin disposition marketing.'
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
