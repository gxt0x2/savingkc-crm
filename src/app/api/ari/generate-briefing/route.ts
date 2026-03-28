import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { notes, motivationScore, sellerSituation, callCount } = await request.json()

    // Try OpenRouter (which has Anthropic models)
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'No API key configured' }, { status: 503 })
    }

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

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-haiku',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'AI service unavailable' }, { status: 503 })
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''

    // Parse JSON from response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return NextResponse.json(parsed)
      }
    } catch {
      // If JSON parsing fails, return raw segments
    }

    return NextResponse.json({
      situation: content.slice(0, 300),
      motivation: '',
      strategy: '',
    })
  } catch (error) {
    console.error('Generate briefing error:', error)
    return NextResponse.json({ error: 'Failed to generate briefing' }, { status: 500 })
  }
}
