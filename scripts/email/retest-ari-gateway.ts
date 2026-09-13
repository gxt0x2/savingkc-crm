/**
 * One reserved Prepare-with-Ari generation against the real AI Gateway.
 * Never sends mail. Does not set hosted EMAIL_AI_ENABLED. Does not unlock live send.
 *
 * Auth is OIDC (`VERCEL_OIDC_TOKEN`) or `AI_GATEWAY_API_KEY`. This VM often has
 * neither; the script then records the exact blocker instead of inventing success.
 */
import { generateText, NoObjectGeneratedError, Output } from 'ai'
import {
  EMAIL_AI_INSTRUCTIONS,
  EMAIL_AI_MODEL,
  emailAiFailureCode,
  emailAiOutputSchema,
} from '../../src/lib/email/ai/provider'

const fixture = {
  messages: [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      direction: 'inbound',
      body: 'Can you call me tomorrow afternoon?',
    },
  ],
}

function authPresent() {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() ||
      process.env.VERCEL_OIDC_TOKEN?.trim(),
  )
}

async function catalogCheck() {
  const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    return { ok: false as const, status: response.status }
  }
  const body = (await response.json()) as {
    data?: { id: string; pricing?: { input?: string; output?: string } }[]
  }
  const model = body.data?.find((row) => row.id === EMAIL_AI_MODEL)
  const inputPrice = Number(model?.pricing?.input)
  const outputPrice = Number(model?.pricing?.output)
  const pricingOk =
    Number.isFinite(inputPrice) &&
    Number.isFinite(outputPrice) &&
    inputPrice <= 0.0000002 &&
    outputPrice <= 0.0000012
  return {
    ok: true as const,
    status: response.status,
    modelFound: Boolean(model),
    inputPrice,
    outputPrice,
    pricingOk,
  }
}

async function oneGeneration() {
  try {
    const result = await generateText({
      model: EMAIL_AI_MODEL,
      system: EMAIL_AI_INSTRUCTIONS,
      prompt: JSON.stringify(fixture),
      output: Output.object({ schema: emailAiOutputSchema }),
      maxOutputTokens: 200,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(45000),
    })
    const inputTokens = result.totalUsage.inputTokens ?? 0
    const outputTokens = result.totalUsage.outputTokens ?? 0
    return {
      reachedGateway: true,
      generated: Boolean(result.output),
      decision:
        result.output && typeof result.output === 'object' && 'decision' in result.output
          ? String(result.output.decision)
          : null,
      inputTokens,
      outputTokens,
      estimatedCostUsd:
        inputTokens * 0.0000002 + outputTokens * 0.0000012,
      providerGenerationId:
        typeof result.providerMetadata?.gateway?.generationId === 'string'
          ? result.providerMetadata.gateway.generationId
          : null,
      failureCode: null as string | null,
      statusCode: null as number | null,
    }
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return {
        reachedGateway: true,
        generated: false,
        decision: null,
        inputTokens: error.usage?.inputTokens ?? 0,
        outputTokens: error.usage?.outputTokens ?? 0,
        estimatedCostUsd:
          (error.usage?.inputTokens ?? 0) * 0.0000002 +
          (error.usage?.outputTokens ?? 0) * 0.0000012,
        providerGenerationId: null,
        failureCode: 'AI_GENERATION_FAILED',
        statusCode: null,
      }
    }
    const e = error as { statusCode?: number; status?: number }
    return {
      reachedGateway: typeof e.statusCode === 'number' || typeof e.status === 'number',
      generated: false,
      decision: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      providerGenerationId: null,
      failureCode: emailAiFailureCode(error),
      statusCode: e.statusCode ?? e.status ?? null,
    }
  }
}

async function main() {
  const catalog = await catalogCheck()
  const credentials = authPresent()
  const generation = credentials
    ? await oneGeneration()
    : {
        reachedGateway: false,
        generated: false,
        decision: null,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        providerGenerationId: null,
        failureCode: 'AI_NOT_CONNECTED',
        statusCode: null,
      }

  const report = {
    kind: 'ari-prepare-retest',
    at: new Date().toISOString(),
    model: EMAIL_AI_MODEL,
    liveSend: false,
    emailAiEnabledHosted: process.env.EMAIL_AI_ENABLED === 'true',
    credentialsPresent: credentials,
    credentialNamesPresent: {
      AI_GATEWAY_API_KEY: Boolean(process.env.AI_GATEWAY_API_KEY?.trim()),
      VERCEL_OIDC_TOKEN: Boolean(process.env.VERCEL_OIDC_TOKEN?.trim()),
    },
    catalog,
    generation,
    result: generation.generated ? 'pass' : 'fail',
    blocker: credentials
      ? generation.failureCode
      : 'This environment has no AI_GATEWAY_API_KEY and no VERCEL_OIDC_TOKEN. Vercel CLI is logged out, so vercel env pull cannot mint OIDC. Prior HTTP 403 for paid credits was not retested against a live token.',
  }

  console.log(JSON.stringify(report, null, 2))
  process.exit(generation.generated ? 0 : 2)
}

void main()
