import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCallReviewFramework } from './call-review-frameworks'
import { CALL_REVIEW_AI_MODEL, generateAiCallReview } from './call-review-ai'

const framework = getCallReviewFramework('junior_acquisitions')!
const originalApiKey = process.env.GROQ_API_KEY

describe('AI call review pre-scoring', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env.GROQ_API_KEY = originalApiKey
  })

  it('normalizes transcript evidence and fills every scorecard item', async () => {
    const requestMock = vi.fn(
      async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
        expect(requestInput).toBe('https://api.groq.com/openai/v1/chat/completions')
        expect(requestInit?.method).toBe('POST')
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assessments: [
                      {
                        id: 'why_now',
                        score: 3,
                        confidence: 'high',
                        evidence: 'We need to sell before the tax auction.',
                        timestamp: null,
                        reasoning:
                          'The seller gave a clear time-sensitive motivation.',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        )
      },
    )
    const request = requestMock as unknown as typeof fetch

    const result = await generateAiCallReview(
      'Seller: We need to sell before the tax auction. Agent: Tell me more about that.',
      framework,
      request,
    )

    expect(result.aiAnswers.why_now).toMatchObject({
      score: 3,
      confidence: 'high',
    })
    expect(result.aiAnswers.timeline).toMatchObject({
      score: 0,
      confidence: 'low',
    })
    expect(Object.keys(result.aiAnswers)).toHaveLength(
      framework.sections.reduce(
        (count, section) => count + section.items.length,
        0,
      ),
    )
    expect(result.scoring.needsCoaching).toBe(true)
    expect(JSON.parse(String((requestMock.mock.calls[0]?.[1] as RequestInit)?.body))).toMatchObject({
      model: CALL_REVIEW_AI_MODEL,
      response_format: { type: 'json_object' },
      max_completion_tokens: 6000,
    })
  })

  it('fails closed when AI scoring is not configured', async () => {
    delete process.env.GROQ_API_KEY
    await expect(
      generateAiCallReview(
        'A sufficiently long transcript for scoring.',
        framework,
      ),
    ).rejects.toThrow('AI scoring is not configured')
  })
})
