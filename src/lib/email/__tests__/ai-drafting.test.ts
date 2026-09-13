import { describe, it, expect } from 'vitest'
import {
  emailAiFailureCode,
  validateEmailAiOutput,
  visibleEmailBody,
} from '../ai/provider'
const messageId = '00000000-0000-4000-8000-000000000001'
const input = {
  messages: [
    {
      id: messageId,
      direction: 'inbound',
      body: 'I might consider selling. Call me tomorrow afternoon.',
    },
  ],
}
const output = {
  decision: 'reply',
  body: 'What time would work for a quick call?',
  summary: 'Seller requested a call.',
  reason: 'Clarify timing.',
  evidence: [{ messageId, quote: 'Call me tomorrow afternoon.' }],
}
describe('Ari evidence and response boundary', () => {
  it('removes quoted history and signatures before model input', () =>
    expect(
      visibleEmailBody(
        'Call tomorrow.\n> old phone\nOn Monday Alex wrote:\nCall 8165551111',
      ),
    ).toBe('Call tomorrow.'))
  it('accepts an evidenced short proposal for human review', () =>
    expect(validateEmailAiOutput(output, input).decision).toBe('reply'))
  it('rejects fabricated quotes', () =>
    expect(
      validateEmailAiOutput(
        {
          ...output,
          evidence: [{ messageId, quote: 'Seller needs urgent cash' }],
        },
        input,
      ).decision,
    ).toBe('review'))
  it('never offers a reply after an opt out', () =>
    expect(
      validateEmailAiOutput(
        {
          ...output,
          evidence: [{ messageId, quote: 'Please unsubscribe me.' }],
        },
        {
          messages: [
            {
              id: messageId,
              direction: 'inbound',
              body: 'Please unsubscribe me.',
            },
          ],
        },
      ).body,
    ).toBe(''))
  it('holds invented commitments and prices', () => {
    for (const body of [
      'Your call is booked.',
      'We offer $200000.',
      'We guarantee a sale.',
    ])
      expect(validateEmailAiOutput({ ...output, body }, input).decision).toBe(
        'review',
      )
  })
  it('clears text when the model requests human review', () =>
    expect(
      validateEmailAiOutput({ ...output, decision: 'review' }, input).body,
    ).toBe(''))
})

it('persists an actionable allowlisted provider diagnosis without private errors', () => {
  expect(
    emailAiFailureCode({
      statusCode: 403,
      message: 'Free tier users do not have access. Upgrade to paid credits.',
    }),
  ).toBe('AI_CREDITS_REQUIRED')
  expect(
    emailAiFailureCode({ statusCode: 401, message: 'private credential' }),
  ).toBe('AI_CONNECTION_EXPIRED')
  expect(
    emailAiFailureCode({ statusCode: 429, message: 'private request' }),
  ).toBe('AI_PROVIDER_LIMIT')
  expect(emailAiFailureCode(new Error('private seller or credential'))).toBe(
    'AI_GENERATION_FAILED',
  )
})
