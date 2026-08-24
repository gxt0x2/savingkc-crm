import { describe, expect, it } from 'vitest'
import {
  assistantPricingSnapshot,
  buildAssistantToolTrace,
  estimateAssistantCostMicros,
  normalizeAssistantSources,
} from './generation-store'

describe('assistant generation accounting', () => {
  it('calculates the catalog price in integer microdollars', () => {
    expect(estimateAssistantCostMicros('openai/gpt-5.4-mini', {
      inputTokens: 1_000,
      outputTokens: 200,
      totalTokens: 1_200,
      cacheReadTokens: 400,
    })).toBe(1_680)
    expect(assistantPricingSnapshot('gpt-5.4-mini')).toMatchObject({
      model: 'openai/gpt-5.4-mini',
      source: 'ai-gateway-model-catalog',
      currency: 'USD',
    })
    expect(estimateAssistantCostMicros('openai/gpt-5.6-luna', {
      inputTokens: 1_000,
      outputTokens: 200,
      totalTokens: 1_200,
      cacheReadTokens: 400,
    })).toBe(448)
    expect(assistantPricingSnapshot('openai/gpt-5.6-luna')).toMatchObject({
      model: 'openai/gpt-5.6-luna',
      source: 'ai-gateway-model-catalog',
      variesByProvider: true,
    })
  })

  it('records the verified Groq model price in integer microdollars', () => {
    expect(estimateAssistantCostMicros('groq/openai/gpt-oss-120b', {
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      cacheReadTokens: null,
    })).toBe(75)
    expect(assistantPricingSnapshot('groq/openai/gpt-oss-120b')).toMatchObject({
      model: 'groq/openai/gpt-oss-120b',
      source: 'groq-model-catalog',
      currency: 'USD',
    })
  })

  it('deduplicates valid sources and stores bounded tool provenance without outputs', () => {
    const source = { name: 'SavingKC CRM', url: 'https://crm.savingkc.com/contacts' }
    expect(normalizeAssistantSources([source, source, { name: 'Bad', url: 'javascript:alert(1)' }])).toEqual([source])
    const result = buildAssistantToolTrace([{
      toolCallId: 'call-1',
      toolName: 'findContacts',
      input: { query: 'Smith' },
      output: { records: [{ id: 'lead-1' }], sources: [source] },
    }])
    expect(result.sources).toEqual([source])
    expect(result.trace).toEqual([expect.objectContaining({ toolCallId: 'call-1', toolName: 'findContacts', resultCount: 1, input: { query: 'Smith' } })])
    expect(result.trace[0]).not.toHaveProperty('output')
  })
})
