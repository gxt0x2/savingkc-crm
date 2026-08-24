import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOJO_CALL_ANALYZER_MODEL, analyzeCallTranscript } from './mojo-call-analyzer'

const originalApiKey = process.env.GROQ_API_KEY

describe('Mojo call analyzer model transport', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env.GROQ_API_KEY = originalApiKey
  })

  it('uses the live-supported Groq model and JSON mode', async () => {
    const requestMock = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      expect(requestInput).toBe('https://api.groq.com/openai/v1/chat/completions')
      expect(requestInit?.method).toBe('POST')
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ aiSummary: 'The seller requested a Friday call.', motivationScore: 6 }) } }],
      }), { status: 200 })
    })

    await expect(analyzeCallTranscript(
      'Seller: Please call me Friday.',
      undefined,
      requestMock as unknown as typeof fetch,
    )).resolves.toMatchObject({ aiSummary: 'The seller requested a Friday call.', motivationScore: 6 })

    expect(JSON.parse(String((requestMock.mock.calls[0]?.[1] as RequestInit)?.body))).toMatchObject({
      model: MOJO_CALL_ANALYZER_MODEL,
      response_format: { type: 'json_object' },
      max_completion_tokens: 4000,
    })
  })
})
