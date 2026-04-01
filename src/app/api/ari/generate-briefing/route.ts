import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { buildManifestBriefingPrompt, type BriefingResult } from '@/lib/manifest-briefing'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/ari/generate-briefing?manifestId={id}
// Returns cached briefing if available and not stale, otherwise generates fresh
export async function GET(request: NextRequest) {
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
      return NextResponse.json({
        situation: cached.situation,
        motivation: cached.motivation,
        strategy: cached.strategy,
        cached: true,
        generatedAt: cached.generatedAt,
      })
    }

    // Generate fresh briefing
    const result = await generateBriefing(manifest, manifestId)
    return NextResponse.json({ ...result, cached: false })
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
      const result = await generateBriefing(manifest, body.manifestId)
      return NextResponse.json({ ...result, cached: false })
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

// Generate briefing from manifest and save to DB
async function generateBriefing(
  manifest: ManifestV2,
  manifestId: string
): Promise<BriefingResult> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured')
  }

  // Build rich prompt
  const prompt = buildManifestBriefingPrompt(manifest)

  // Determine data sources used
  const dataSources: string[] = []
  if (manifest.communications?.transcripts?.length) {
    dataSources.push('transcripts')
  }
  if (manifest.agentNotes?.length) {
    dataSources.push('agent_notes')
  }
  if (manifest.ariIntelligence?.dealIntelligence) {
    dataSources.push('deal_math')
  }
  if (manifest.property.assessment || manifest.property.taxCollector || manifest.property.dwelling) {
    dataSources.push('enrichment')
  }

  // Call Llama 3.3 70B via Groq (free tier, fast)
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.7,
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenRouter API error: ${res.status}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''

  // Parse JSON from response — handle various Groq/LLM wrapping quirks
  let briefing: BriefingResult
  const tryParseJSON = (str: string): any => {
    try { return JSON.parse(str) } catch { return null }
  }
  const extractBriefing = (obj: any): BriefingResult | null => {
    if (!obj || typeof obj !== 'object') return null
    if (obj.situation && (obj.motivation || obj.strategy)) return obj
    // Check if values are nested JSON strings
    const s = typeof obj.situation === 'string' ? tryParseJSON(obj.situation) : null
    if (s && s.situation) return s
    return null
  }

  try {
    // First try: direct parse of content
    let parsed = tryParseJSON(content)
    let extracted = parsed ? extractBriefing(parsed) : null

    // Second try: extract JSON block
    if (!extracted) {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = tryParseJSON(jsonMatch[0])
        extracted = parsed ? extractBriefing(parsed) : null
      }
    }

    // Third try: the situation field itself might be the full briefing JSON
    if (!extracted && parsed?.situation) {
      const inner = tryParseJSON(parsed.situation)
      if (inner) extracted = extractBriefing(inner)
    }

    if (extracted) {
      briefing = {
        situation: String(extracted.situation || 'No situation data'),
        motivation: String(extracted.motivation || 'Motivation assessment unavailable'),
        strategy: String(extracted.strategy || 'Strategy unavailable'),
      }
    } else {
      throw new Error('Could not extract briefing from response')
    }
  } catch {
    briefing = {
      situation: content.slice(0, 500) || 'Unable to generate situation summary',
      motivation: 'Motivation assessment unavailable',
      strategy: 'Strategy unavailable',
    }
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
        situation: briefing.situation,
        motivation: briefing.motivation,
        strategy: briefing.strategy,
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
        details: { dataSources },
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

  return briefing
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
