import { NextResponse } from 'next/server'
import type { ModelMessage } from 'ai'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { assistantActorCanReadCompanyWide, resolveAssistantActor, type AssistantActor } from '@/lib/assistant/auth'
import {
  readAssistantAttention,
  readAssistantOperatingSnapshot,
  readAssistantPhoneSystem,
  readAssistantWorkflowRegistry,
} from '@/lib/assistant/queries'
import { createCommandAgent, commandAgentInstructions } from '@/lib/ai/command-agent'
import {
  AssistantGenerationError,
  buildAssistantToolTrace,
  completeAssistantGeneration,
  failAssistantGeneration,
  loadAssistantThread,
  replayAssistantGeneration,
  startAssistantGeneration,
  type AssistantSource,
  type AssistantSurface,
  type AssistantToolTrace,
  type AssistantUsage,
} from '@/lib/ai/generation-store'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type CommandMessage = { role: 'user' | 'assistant'; content: string }
type CommandAttachment = { name: string; mediaType: string; dataUrl: string; base64: string; size: number }
type ProviderReply = {
  reply: string
  provider: string
  model: string
  finishReason: string
  usage: AssistantUsage
  toolTrace: AssistantToolTrace[]
  sources: AssistantSource[]
}

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/json', 'application/pdf', 'image/heic', 'image/jpeg', 'image/png',
  'image/webp', 'text/csv', 'text/markdown', 'text/plain', 'text/xml',
])

function cleanMessages(value: unknown): CommandMessage[] {
  if (!Array.isArray(value)) return []
  return value.slice(-20).flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const role = 'role' in message && (message.role === 'user' || message.role === 'assistant') ? message.role : null
    const content = 'content' in message && typeof message.content === 'string' ? message.content.trim().slice(0, 8_000) : ''
    return role && content ? [{ role, content }] : []
  })
}

function cleanAttachments(value: unknown): CommandAttachment[] {
  if (!Array.isArray(value)) return []
  let totalSize = 0
  return value.slice(0, 3).flatMap((attachment) => {
    if (!attachment || typeof attachment !== 'object') return []
    const name = 'name' in attachment && typeof attachment.name === 'string' ? attachment.name.trim().slice(0, 120) : ''
    const mediaType = 'mediaType' in attachment && typeof attachment.mediaType === 'string' ? attachment.mediaType.trim().toLowerCase() : ''
    const dataUrl = 'dataUrl' in attachment && typeof attachment.dataUrl === 'string' ? attachment.dataUrl : ''
    if (!name || !ALLOWED_ATTACHMENT_TYPES.has(mediaType)) throw new AssistantGenerationError('invalid_attachment', 400, `Unsupported attachment type: ${mediaType || 'unknown'}`)
    const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
    if (!match || match[1].toLowerCase() !== mediaType) throw new AssistantGenerationError('invalid_attachment', 400, `Attachment ${name} is not a valid ${mediaType} file.`)
    const base64 = match[2]
    const size = Buffer.byteLength(base64, 'base64')
    if (size > 2_000_000) throw new AssistantGenerationError('invalid_attachment', 400, `${name} is larger than the 2 MB attachment limit.`)
    totalSize += size
    if (totalSize > 3_000_000) throw new AssistantGenerationError('invalid_attachment', 400, 'Attachments exceed the 3 MB request limit.')
    return [{ name, mediaType, dataUrl, base64, size }]
  })
}

function cleanSurface(value: unknown): AssistantSurface {
  return value === 'giraffe' ? 'giraffe' : value === 'api' ? 'api' : 'ai_page'
}

function cleanRequestId(value: unknown): string {
  const requestId = typeof value === 'string' ? value.trim() : ''
  return requestId && requestId.length <= 160 ? requestId : crypto.randomUUID()
}

function gatewayMessages(messages: CommandMessage[], attachments: CommandAttachment[]): ModelMessage[] {
  const lastIndex = messages.length - 1
  return messages.map((message, index) => {
    if (message.role === 'user' && index === lastIndex && attachments.length > 0) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: message.content },
          ...attachments.map((attachment) => ({
            type: 'file' as const,
            data: { type: 'data' as const, data: attachment.base64 },
            filename: attachment.name,
            mediaType: attachment.mediaType,
          })),
        ],
      }
    }
    return { role: message.role, content: message.content }
  })
}

function textAttachmentContext(attachments: CommandAttachment[]) {
  return attachments.flatMap((attachment) => {
    if (!(attachment.mediaType.startsWith('text/') || attachment.mediaType === 'application/json')) return []
    const text = Buffer.from(attachment.base64, 'base64').toString('utf8').slice(0, 24_000)
    return [`Attached file ${attachment.name} (${attachment.mediaType}):\n${text}`]
  }).join('\n\n')
}

function collectSources(values: unknown[]): AssistantSource[] {
  const unique = new Map<string, AssistantSource>()
  for (const value of values) {
    if (!value || typeof value !== 'object' || !Array.isArray((value as { sources?: unknown }).sources)) continue
    for (const item of (value as { sources: unknown[] }).sources) {
      if (!item || typeof item !== 'object') continue
      const source = item as AssistantSource
      if (source.name && /^https?:\/\//i.test(source.url)) unique.set(`${source.name}|${source.url}`, source)
    }
  }
  return [...unique.values()].slice(0, 30)
}

async function directProviderReply(actor: AssistantActor, messages: CommandMessage[], attachments: CommandAttachment[]): Promise<ProviderReply> {
  const db = supabaseAdmin()
  const contextValues = assistantActorCanReadCompanyWide(actor)
    ? await Promise.all([readAssistantOperatingSnapshot(30), readAssistantWorkflowRegistry(db), Promise.resolve(readAssistantPhoneSystem())])
    : [await readAssistantAttention(db, actor, 15)]
  const sources = collectSources(contextValues)
  const system = `${commandAgentInstructions()}\n\nSigned-in actor: ${actor.fullName} (${actor.access}). The following authorized, live read-only context was loaded for this request:\n${JSON.stringify(contextValues)}`
  const groqKey = process.env.GROQ_API_KEY
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (!groqKey && !openRouterKey) throw new Error('No AI provider is configured')
  const binaryAttachments = attachments.filter((attachment) => !(attachment.mediaType.startsWith('text/') || attachment.mediaType === 'application/json'))
  if (binaryAttachments.some((attachment) => attachment.mediaType === 'application/pdf') || (binaryAttachments.length > 0 && !openRouterKey)) {
    throw new AssistantGenerationError('attachment_provider_unavailable', 400, binaryAttachments.some((attachment) => attachment.mediaType === 'application/pdf')
      ? 'PDF attachments require AI Gateway.'
      : 'Image attachments require AI Gateway or OpenRouter.')
  }
  const attachmentContext = textAttachmentContext(attachments)
  const enrichedMessages = messages.map((message, index) => index === messages.length - 1 && message.role === 'user' && attachmentContext
    ? { ...message, content: `${message.content}\n\n${attachmentContext}` }
    : message)
  const openRouterMessages = enrichedMessages.map((message, index) => {
    if (message.role !== 'user' || index !== enrichedMessages.length - 1 || binaryAttachments.length === 0) return message
    return {
      role: 'user',
      content: [
        { type: 'text', text: message.content },
        ...binaryAttachments.filter((attachment) => attachment.mediaType.startsWith('image/')).map((attachment) => ({ type: 'image_url', image_url: { url: attachment.dataUrl } })),
      ],
    }
  })

  const usingGroq = Boolean(groqKey && binaryAttachments.length === 0)
  const model = usingGroq ? 'groq/llama-3.3-70b-versatile' : 'openrouter/anthropic/claude-3.5-haiku'
  const response = usingGroq
    ? await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 900, temperature: 0.2, messages: [{ role: 'system', content: system }, ...enrichedMessages] }),
      })
    : await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openRouterKey}`, 'HTTP-Referer': 'https://crm.savingkc.com', 'X-Title': 'SavingKC AI Assistant' },
        body: JSON.stringify({ model: 'anthropic/claude-3.5-haiku', max_tokens: 900, temperature: 0.2, messages: [{ role: 'system', content: system }, ...openRouterMessages] }),
      })
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`)
  const data = await response.json()
  const reply = typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content.trim() : ''
  if (!reply) throw new Error('AI provider returned no answer')
  const inputTokens = Number.isInteger(data?.usage?.prompt_tokens) ? data.usage.prompt_tokens : null
  const outputTokens = Number.isInteger(data?.usage?.completion_tokens) ? data.usage.completion_tokens : null
  const totalTokens = Number.isInteger(data?.usage?.total_tokens) ? data.usage.total_tokens : null
  return {
    reply,
    provider: usingGroq ? 'groq' : 'openrouter',
    model,
    finishReason: String(data?.choices?.[0]?.finish_reason || 'stop'),
    usage: { inputTokens, outputTokens, totalTokens, cacheReadTokens: null },
    toolTrace: [],
    sources,
  }
}

function responsePayload(result: Awaited<ReturnType<typeof replayAssistantGeneration>>) {
  return {
    reply: result.reply,
    threadId: result.threadId,
    generationId: result.generationId,
    responseMessageId: result.responseMessageId,
    sources: result.sources,
    provider: result.provider,
    model: result.model,
    finishReason: result.finishReason,
    usage: result.usage,
    estimatedCostMicros: result.estimatedCostMicros,
    grounded: true,
    execution: 'read_only',
    approvalRequiredFor: ['calls and messages', 'assignment', 'stage changes', 'workflow publishing', 'phone routing changes', 'deletes', 'spending'],
  }
}

function failure(error: unknown) {
  if (error instanceof AssistantGenerationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: HEADERS })
  }
  console.error('[ai-command] request failed', error)
  return NextResponse.json({ error: 'The AI Assistant could not complete this request.' }, { status: 500, headers: HEADERS })
}

export async function POST(request: Request) {
  const authenticated = await resolveAuthenticatedActor()
  if (!authenticated) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  const actor = await resolveAssistantActor(authenticated.email)
  if (!actor) return NextResponse.json({ error: 'CRM profile not authorized' }, { status: 403, headers: HEADERS })

  let generationId: string | null = null
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const clientMessages = cleanMessages(body?.messages)
    const latestUserMessage = clientMessages.at(-1)
    if (!latestUserMessage || latestUserMessage.role !== 'user') {
      return NextResponse.json({ error: 'A user request is required.' }, { status: 400, headers: HEADERS })
    }
    const attachments = cleanAttachments(body?.attachments)
    const started = await startAssistantGeneration({
      threadId: typeof body?.threadId === 'string' ? body.threadId : null,
      actorEmail: actor.email,
      actorName: actor.fullName,
      surface: cleanSurface(body?.surface),
      content: latestUserMessage.content,
      attachments: attachments.map(({ name, mediaType, size }) => ({ name, mediaType, size })),
      requestId: cleanRequestId(body?.requestId),
    })
    generationId = started.generationId

    if (!started.created) {
      const existing = await replayAssistantGeneration(actor.email, started.generationId)
      if (existing.status === 'complete' && existing.reply) return NextResponse.json(responsePayload(existing), { headers: HEADERS })
      return NextResponse.json({ error: existing.status === 'running' ? 'A response is already in progress.' : 'This request was already attempted.', code: `generation_${existing.status}` }, { status: 409, headers: HEADERS })
    }

    const stored = await loadAssistantThread(actor.email, started.threadId)
    const messages = stored.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-20)
      .map((message) => ({ role: message.role as CommandMessage['role'], content: message.content }))
    const gatewayAvailable = Boolean(process.env.AI_GATEWAY_API_KEY || (process.env.VERCEL === '1' && process.env.VERCEL_OIDC_TOKEN))
    let providerReply: ProviderReply
    if (gatewayAvailable) {
      const result = await createCommandAgent(actor).generate({ messages: gatewayMessages(messages, attachments) })
      const traced = buildAssistantToolTrace(result.toolResults.map((toolResult) => ({
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        input: toolResult.input,
        output: toolResult.output,
      })))
      const provider = result.finalStep.model.provider
      const modelId = result.finalStep.model.modelId
      providerReply = {
        reply: result.text.trim(),
        provider,
        model: modelId.includes('/') ? modelId : `${provider}/${modelId}`,
        finishReason: result.finishReason,
        usage: {
          inputTokens: result.usage.inputTokens ?? null,
          outputTokens: result.usage.outputTokens ?? null,
          totalTokens: result.usage.totalTokens ?? null,
          cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? null,
        },
        toolTrace: traced.trace,
        sources: traced.sources,
      }
    } else {
      providerReply = await directProviderReply(actor, messages, attachments)
    }
    if (!providerReply.reply) throw new Error('AI provider returned no answer')

    await completeAssistantGeneration({
      generationId: started.generationId,
      actorEmail: actor.email,
      content: providerReply.reply,
      provider: providerReply.provider,
      model: providerReply.model,
      finishReason: providerReply.finishReason,
      usage: providerReply.usage,
      toolTrace: providerReply.toolTrace,
      sources: providerReply.sources,
      metadata: { surface: cleanSurface(body?.surface), readOnly: true },
    })
    const completed = await replayAssistantGeneration(actor.email, started.generationId)
    return NextResponse.json(responsePayload(completed), { headers: HEADERS })
  } catch (error) {
    if (generationId) {
      await failAssistantGeneration({
        generationId,
        actorEmail: actor.email,
        code: error instanceof AssistantGenerationError ? error.code : 'generation_failed',
        message: error instanceof Error ? error.message : 'AI generation failed',
      })
    }
    return failure(error)
  }
}
