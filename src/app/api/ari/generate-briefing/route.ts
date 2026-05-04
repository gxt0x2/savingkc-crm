import { NextRequest, NextResponse } from 'next/server'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { buildManifestBriefingPrompt, type BriefingResult, type ActivityRow } from '@/lib/manifest-briefing'
import { detectDeceasedSignals } from '@/lib/manifest-sync'
import { supabase } from '@/lib/supabase-lazy'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

// GET /api/ari/generate-briefing?manifestId={id}
// Returns cached briefing if available and not stale, otherwise generates fresh
export async function GET(request: NextRequest) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const searchParams = request.nextUrl.searchParams
    const manifestId = searchParams.get('manifestId')

    if (!manifestId) {
      return NextResponse.json(
        { error: 'manifestId required' },
        { status: 400 }
      )
    }

    // Fetch manifest
    const { data: manifestRow, error: fetchError } = await supabase
      .from('manifests')
      .select('*')
      .eq('id', manifestId)
      .single()

    if (fetchError || !manifestRow) {
      return NextResponse.json(
        { error: 'Manifest not found' },
        { status: 404 }
      )
    }

    const manifest = manifestRow.manifest as ManifestV2

    // Check for cached briefing
    const cached = manifest.ariIntelligence?.lastBriefing
    const isStale = manifest.ariIntelligence?.briefingStale === true

    if (cached && !isStale) {
      // Sanitize cached briefing: handle nested JSON and label prefixes
      let { situation, motivation, strategy } = cached

      const sanitizeCachedField = (val: string | undefined, fieldName: string): string => {
        if (!val) return ''
        let s = String(val).trim()
        // Unwrap nested JSON
        if (s.startsWith('{')) {
          try {
            const inner = JSON.parse(s)
            if (inner[fieldName] && typeof inner[fieldName] === 'string') {
              s = inner[fieldName]
            }
          } catch { /* use as-is */ }
        }
        // Strip leading label prefix (e.g., "Situation: ...")
        s = s.replace(new RegExp(`^${fieldName}\\s*[:\\-–—]\\s*`, 'i'), '')
        return s
      }

      return NextResponse.json({
        situation: sanitizeCachedField(situation, 'situation'),
        motivation: sanitizeCachedField(motivation, 'motivation'),
        strategy: sanitizeCachedField(strategy, 'strategy'),
        cached: true,
        generatedAt: cached.generatedAt,
      })
    }

    // Generate fresh briefing (with activity hydration)
    const leadId = manifestRow.lead_id
    const activities = leadId ? await fetchRecentActivities(leadId) : []
    const result = await generateBriefing(manifest, manifestId, activities, leadId)
    return NextResponse.json({ ...result, cached: false, generatedAt: new Date().toISOString() })
  } catch (error) {
    console.error('GET briefing error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve briefing' },
      { status: 500 }
    )
  }
}

// POST /api/ari/generate-briefing
// Accepts { manifestId } or legacy { notes, motivationScore, sellerSituation, callCount }
export async function POST(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const body = await request.json()

    // Manifest-based briefing
    if (body.manifestId) {
      const { data: manifestRow, error: fetchError } = await supabase
        .from('manifests')
        .select('*')
        .eq('id', body.manifestId)
        .single()

      if (fetchError || !manifestRow) {
        return NextResponse.json(
          { error: 'Manifest not found' },
          { status: 404 }
        )
      }

      const manifest = manifestRow.manifest as ManifestV2
      const leadId = manifestRow.lead_id
      const activities = leadId ? await fetchRecentActivities(leadId) : []
      const result = await generateBriefing(manifest, body.manifestId, activities, leadId)
      return NextResponse.json({ ...result, cached: false, generatedAt: new Date().toISOString() })
    }

    // Legacy mode: simple briefing from basic data
    const { notes, motivationScore, sellerSituation, callCount } = body
    const result = await generateLegacyBriefing({
      notes,
      motivationScore,
      sellerSituation,
      callCount,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Generate briefing error:', error)
    return NextResponse.json(
      { error: 'Failed to generate briefing' },
      { status: 500 }
    )
  }
}

/**
 * Fetch recent activities for a lead from lead_activities.
 * This is the key hydration step — brings in SMS, calls, notes, appointments,
 * ghost protocol status, etc. that endpoints log but don't sync to manifests.
 */
async function fetchRecentActivities(leadId: string): Promise<ActivityRow[]> {
  const { data } = await supabase
    .from('lead_activities')
    .select('id, lead_id, activity_type, description, agent, metadata, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(100)

  return (data || []) as ActivityRow[]
}

// Generate briefing from manifest + activities and save to DB
async function generateBriefing(
  manifest: ManifestV2,
  manifestId: string,
  activities: ActivityRow[],
  leadId?: string,
): Promise<BriefingResult> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured')
  }

  // Auto-detect deceased from activity content before building prompt
  if (leadId && !manifest.owner.deceased) {
    const allText = activities
      .map(a => a.description || '')
      .join(' ')
    if (detectDeceasedSignals(allText)) {
      manifest.owner.deceased = true
      if (!manifest.situation.type.includes('inherited')) {
        manifest.situation.type.push('inherited')
      }
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('deceased_owner')) {
        manifest.flags.opportunityFlags.push('deceased_owner')
      }
    }
  }

  // Build rich prompt with live activity data
  const prompt = buildManifestBriefingPrompt(manifest, activities)

  // Determine data sources used
  const dataSources: string[] = []
  if (manifest.communications?.transcripts?.length) dataSources.push('transcripts')
  if (manifest.agentNotes?.length) dataSources.push('agent_notes')
  if (manifest.ariIntelligence?.dealIntelligence) dataSources.push('deal_math')
  if (manifest.property.assessment || manifest.property.taxCollector || manifest.property.dwelling) {
    dataSources.push('enrichment')
  }
  if (activities.length) dataSources.push('lead_activities')

  const smsCount = activities.filter(a => a.activity_type === 'sms').length
  const callCount = activities.filter(a => a.activity_type === 'call').length
  if (smsCount) dataSources.push(`${smsCount}_sms`)
  if (callCount) dataSources.push(`${callCount}_calls`)

  // Call Llama 3.3 70B via Groq
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''

  // Parse JSON from response
  let briefing: BriefingResult
  const tryParseJSON = (str: string): any => {
    try { return JSON.parse(str) } catch { return null }
  }
  const extractBriefing = (obj: any): BriefingResult | null => {
    if (!obj || typeof obj !== 'object') return null
    // If situation is itself a JSON string, parse and use its contents
    if (typeof obj.situation === 'string' && obj.situation.trimStart().startsWith('{')) {
      const inner = tryParseJSON(obj.situation)
      if (inner?.situation) return inner
    }
    // Accept if we have at least situation - the others are optional
    if (obj.situation) return obj
    return null
  }

  try {
    let parsed = tryParseJSON(content)
    let extracted = parsed ? extractBriefing(parsed) : null

    if (!extracted) {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = tryParseJSON(jsonMatch[0])
        extracted = parsed ? extractBriefing(parsed) : null
      }
    }

    if (!extracted && parsed?.situation) {
      const inner = tryParseJSON(parsed.situation)
      if (inner) extracted = extractBriefing(inner)
    }

    if (extracted) {
      // Any field truly empty means the generation did NOT understand the data.
      // Returning canned filler like "Schedule call to assess opportunity" was
      // the "generic mush" Ernest kept seeing — it hides that the LLM bailed.
      // Throw so we either retry (POST path) or return an explicit error.
      const hasSituation = extracted.situation?.trim()
      const hasMotivation = extracted.motivation?.trim()
      const hasStrategy = extracted.strategy?.trim()
      if (!hasSituation || !hasMotivation || !hasStrategy) {
        throw new Error('Briefing fields empty — incomplete LLM output')
      }
      briefing = {
        situation: hasSituation,
        motivation: hasMotivation,
        strategy: hasStrategy,
      }
    } else {
      throw new Error('Could not extract briefing from response')
    }
  } catch (err) {
    // Don't cache garbage. Bubble up so the caller (GET/POST handler)
    // returns an error and the UI can show a retry state instead of
    // silently persisting "Motivation assessment unavailable" mush.
    console.error('[generate-briefing] extraction failed:', (err as Error).message, 'raw:', content.slice(0, 300))
    throw new Error(`briefing_extraction_failed: ${(err as Error).message}`)
  }

  // Final sanitization: ensure no nested JSON or label prefixes in fields
  const cleanField = (value: string, fieldName: string): string => {
    let cleaned = String(value || '').trim()

    // Check if the entire value is a JSON object with the same field name
    if (cleaned.startsWith('{') && cleaned.includes(`"${fieldName}"`)) {
      try {
        const parsed = JSON.parse(cleaned)
        if (parsed[fieldName] && typeof parsed[fieldName] === 'string') {
          cleaned = parsed[fieldName]
        }
      } catch {
        // Not valid JSON (often truncated), extract via flexible regex
        const pattern = new RegExp(`\\{[\\s\\n]*"${fieldName}"[\\s\\n]*:[\\s\\n]*"([^"]*(?:"[^}]*)?)"?[\\s\\n]*\\}?`, 's')
        const match = cleaned.match(pattern)
        if (match && match[1]) {
          cleaned = match[1]
        } else {
          const simplePattern = new RegExp(`"${fieldName}"[\\s\\n]*:[\\s\\n]*"([\\s\\S]+)`)
          const simpleMatch = cleaned.match(simplePattern)
          if (simpleMatch && simpleMatch[1]) {
            cleaned = simpleMatch[1].replace(/"[\\s\\n]*\}?$/, '').trim()
          }
        }
      }
    }

    // Strip leading label prefixes (e.g., "Situation: The homeowner..." → "The homeowner...")
    const labelPattern = new RegExp(`^${fieldName}\\s*[:\\-–—]\\s*`, 'i')
    cleaned = cleaned.replace(labelPattern, '')

    return cleaned
  }

  // If Groq dumped everything into situation and left motivation/strategy empty,
  // try to split it out by looking for labeled sections
  const splitBriefingFields = (b: BriefingResult): BriefingResult => {
    const sit = b.situation || ''
    const hasEmptyMotivation = !b.motivation?.trim() || b.motivation === 'Contact needed to gauge motivation level'
    const hasEmptyStrategy = !b.strategy?.trim() || b.strategy === 'Schedule call to assess opportunity and build rapport'

    if (hasEmptyMotivation || hasEmptyStrategy) {
      // Try to find labeled sections within the situation text
      const motMatch = sit.match(/(?:motivation|urgency)\s*[:\-–—]\s*([\s\S]*?)(?=(?:strategy|approach|recommendation)\s*[:\-–—]|$)/i)
      const stratMatch = sit.match(/(?:strategy|approach|recommendation)\s*[:\-–—]\s*([\s\S]*?)$/i)
      const sitMatch = sit.match(/^([\s\S]*?)(?=(?:motivation|urgency)\s*[:\-–—])/i)

      if (motMatch || stratMatch) {
        return {
          situation: (sitMatch ? sitMatch[1] : sit).trim(),
          motivation: (motMatch ? motMatch[1] : b.motivation || '').trim(),
          strategy: (stratMatch ? stratMatch[1] : b.strategy || '').trim(),
        }
      }
    }
    return b
  }

  const splitBriefing = splitBriefingFields(briefing)
  const sanitizedBriefing = {
    situation: cleanField(splitBriefing.situation, 'situation'),
    motivation: cleanField(splitBriefing.motivation, 'motivation'),
    strategy: cleanField(splitBriefing.strategy, 'strategy'),
  }

  // Save briefing to manifest
  const updatedManifest: ManifestV2 = {
    ...manifest,
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: 'system:ari',
    ariIntelligence: {
      ...manifest.ariIntelligence,
      briefingStale: false,
      lastBriefing: {
        situation: sanitizedBriefing.situation,
        motivation: sanitizedBriefing.motivation,
        strategy: sanitizedBriefing.strategy,
        generatedAt: new Date().toISOString(),
        generatedFrom: dataSources,
      },
    },
    auditTrail: [
      ...(manifest.auditTrail || []),
      {
        timestamp: new Date().toISOString(),
        agent: 'system:ari',
        action: 'briefing_generated',
        details: { dataSources, activityCount: activities.length },
      },
    ],
  }

  // Update in Supabase
  await supabase
    .from('manifests')
    .update({
      manifest: updatedManifest,
      updated_at: new Date().toISOString(),
    })
    .eq('id', manifestId)

  // Dual-write to relational briefings table — readers fall back to
  // manifest until enough leads are migrated. Step 4 of the demote-the-
  // manifest plan.
  if (leadId) {
    try {
      const { saveBriefing } = await import('@/lib/briefings')
      await saveBriefing({
        leadId,
        situation: sanitizedBriefing.situation || null,
        motivation: sanitizedBriefing.motivation || null,
        strategy: sanitizedBriefing.strategy || null,
        generatedFrom: dataSources,
        generatedBy: 'system:ari',
      })
    } catch (e) {
      console.error('[generate-briefing] briefings table write failed:', e)
    }
  }

  return sanitizedBriefing
}

// Legacy briefing generation (for backward compatibility)
async function generateLegacyBriefing(params: {
  notes?: string
  motivationScore?: number
  sellerSituation?: string
  callCount?: number
}): Promise<BriefingResult> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured')
  }

  const { notes, motivationScore, sellerSituation, callCount } = params

  const prompt = `You are Ari, an AI assistant for a real estate wholesaling company called Saving KC. Analyze this seller lead data and provide a brief intelligence briefing.

Available data:
- Seller notes: ${notes || 'None'}
- Seller situation: ${sellerSituation || 'Unknown'}
- Motivation score: ${motivationScore ?? 'Not assessed'}
- Number of calls logged: ${callCount || 0}

Respond in JSON format with exactly three fields:
{
  "situation": "2-3 sentence summary of the seller's current situation",
  "motivation": "1-2 sentence assessment of seller motivation and urgency",
  "strategy": "2-3 sentence recommended approach for next contact"
}

Keep it concise, actionable, and professional. Focus on what matters for closing a wholesale deal.`

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.7,
    }),
  })

  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch {
    // Fallback
  }

  return {
    situation: content.slice(0, 300),
    motivation: '',
    strategy: '',
  }
}
