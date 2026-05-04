import { NextResponse } from 'next/server'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

export async function POST(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const body = await request.json()
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) return NextResponse.json({ analysis: '' })

    const prompt = `You are Ari, AI advisor for a real estate wholesaling company. Given this deal score data, write a 1-2 sentence analysis.

Score: ${body.score}/10
Motivation: ${body.motivationScore ?? 'unknown'}/10
ARV: $${body.arv ?? 0}
Offer/Asking: $${body.offerAmount ?? 0}
Repair Estimate: $${body.repairEstimate ?? 0}
Stage: ${body.station || 'intake'}
Notes: ${body.notes || 'none'}

Write ONLY the analysis text. Be direct, professional, actionable. No intro phrases.`

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-haiku',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.7,
      }),
    })

    if (!res.ok) return NextResponse.json({ analysis: '' })

    const data = await res.json()
    const analysis = data.choices?.[0]?.message?.content?.trim() || ''
    return NextResponse.json({ analysis })
  } catch {
    return NextResponse.json({ analysis: '' })
  }
}
