import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { text, motivationScore } = await request.json()

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey || !text) {
      return NextResponse.json({ painPoints: [] }, { status: 200 })
    }

    const prompt = `Analyze this real estate seller's data and extract pain points categorized by time period.

Seller data: ${text.slice(0, 2000)}
Motivation score: ${motivationScore ?? 'unknown'} (scale 1-10)

Respond in JSON:
{
  "painPoints": [
    { "period": "past", "items": ["specific past events causing distress"] },
    { "period": "present", "items": ["current problems they face"] },
    { "period": "future", "items": ["fears or upcoming deadlines"] }
  ]
}

Only include periods that have actual data. Keep items brief (under 10 words each). Maximum 3 items per period.`

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-5-haiku-20241022',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.5,
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ painPoints: [] })
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return NextResponse.json(parsed)
      }
    } catch {
      // parsing failed
    }

    return NextResponse.json({ painPoints: [] })
  } catch (error) {
    console.error('Extract pain points error:', error)
    return NextResponse.json({ painPoints: [] })
  }
}
