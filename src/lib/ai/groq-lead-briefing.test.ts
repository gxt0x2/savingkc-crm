import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GROQ_LEAD_BRIEFING_MODEL,
  generateGroqLeadBriefing,
} from './groq-lead-briefing'

const originalApiKey = process.env.GROQ_API_KEY

describe('Groq canonical lead briefing transport', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env.GROQ_API_KEY = originalApiKey
  })

  it('requests JSON mode and normalizes provider accounting', async () => {
    const requestMock = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      expect(requestInput).toBe('https://api.groq.com/openai/v1/chat/completions')
      expect(requestInit?.method).toBe('POST')
      return new Response(JSON.stringify({
        model: GROQ_LEAD_BRIEFING_MODEL,
        choices: [{
          finish_reason: 'stop',
          message: { content: JSON.stringify({ situation: 'Situation', evidenceIds: ['lead:1'] }) },
        }],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      }), { status: 200 })
    })
    const request = requestMock as unknown as typeof fetch

    const result = await generateGroqLeadBriefing({ system: 'System', prompt: 'Prompt', request })

    expect(result).toMatchObject({
      provider: 'groq',
      model: `groq/${GROQ_LEAD_BRIEFING_MODEL}`,
      finishReason: 'stop',
      usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160, cacheReadTokens: null },
    })
    const body = JSON.parse(String((requestMock.mock.calls[0]?.[1] as RequestInit)?.body))
    expect(body).toMatchObject({
      model: GROQ_LEAD_BRIEFING_MODEL,
      response_format: { type: 'json_object' },
    })
  })

  it('fails closed without configuration or valid JSON', async () => {
    delete process.env.GROQ_API_KEY
    await expect(generateGroqLeadBriefing({ system: 'System', prompt: 'Prompt' }))
      .rejects.toThrow('groq_briefing_not_configured')

    process.env.GROQ_API_KEY = 'test-key'
    const invalid = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'not-json' } }],
    }), { status: 200 })) as unknown as typeof fetch
    await expect(generateGroqLeadBriefing({ system: 'System', prompt: 'Prompt', request: invalid }))
      .rejects.toThrow('groq_briefing_json_invalid')
  })

  it('returns a bounded status error without exposing the provider response', async () => {
    const request = vi.fn(async () => new Response('secret provider detail', { status: 429 })) as unknown as typeof fetch
    await expect(generateGroqLeadBriefing({ system: 'System', prompt: 'Prompt', request }))
      .rejects.toThrow('groq_briefing_request_failed:429')
  })
})
