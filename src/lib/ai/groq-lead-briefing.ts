import type { AssistantUsage } from '@/lib/ai/generation-store'

export const GROQ_LEAD_BRIEFING_MODEL = 'openai/gpt-oss-120b'

type GroqChatPayload = {
  choices?: Array<{
    finish_reason?: unknown
    message?: { content?: unknown }
  }>
  model?: unknown
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
  }
}

function tokenCount(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export type GroqLeadBriefingResult = {
  output: unknown
  provider: 'groq'
  model: string
  finishReason: string
  usage: AssistantUsage
}

export async function generateGroqLeadBriefing(input: {
  system: string
  prompt: string
  request?: typeof fetch
}): Promise<GroqLeadBriefingResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) throw new Error('groq_briefing_not_configured')

  const response = await (input.request || fetch)(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_LEAD_BRIEFING_MODEL,
        messages: [
          { role: 'system', content: input.system },
          {
            role: 'user',
            content: `${input.prompt}\n\nReturn JSON only with this exact shape: {"situation":"string","motivation":"string","strategy":"string","confidence":"high|medium|low","evidenceIds":["exact evidence id"]}.`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_completion_tokens: 1_800,
      }),
      signal: AbortSignal.timeout(45_000),
    },
  )
  if (!response.ok) throw new Error(`groq_briefing_request_failed:${response.status}`)

  let payload: GroqChatPayload
  try {
    payload = await response.json() as GroqChatPayload
  } catch {
    throw new Error('groq_briefing_response_invalid')
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('groq_briefing_response_empty')

  let output: unknown
  try {
    output = JSON.parse(content)
  } catch {
    throw new Error('groq_briefing_json_invalid')
  }

  const returnedModel = typeof payload.model === 'string' && payload.model.trim()
    ? payload.model.trim()
    : GROQ_LEAD_BRIEFING_MODEL
  return {
    output,
    provider: 'groq',
    model: `groq/${returnedModel}`,
    finishReason: typeof payload.choices?.[0]?.finish_reason === 'string'
      ? payload.choices[0].finish_reason
      : 'stop',
    usage: {
      inputTokens: tokenCount(payload.usage?.prompt_tokens),
      outputTokens: tokenCount(payload.usage?.completion_tokens),
      totalTokens: tokenCount(payload.usage?.total_tokens),
      cacheReadTokens: null,
    },
  }
}
