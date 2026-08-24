import { supabaseAdmin } from '@/lib/supabase/admin'

export type AssistantSurface = 'ai_page' | 'giraffe' | 'api'

export type AssistantSource = {
  name: string
  url: string
  generatedAt?: string
  detail?: string
}

export type AssistantUsage = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
}

export type AssistantToolTrace = {
  toolCallId: string
  toolName: string
  input: unknown
  resultCount: number | null
  sources: AssistantSource[]
}

export type AssistantThreadSummary = {
  id: string
  title: string
  status: 'active' | 'archived'
  surface: AssistantSurface
  lastMessageAt: string
  createdAt: string
  updatedAt: string
}

export type AssistantStoredMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  attachments: Array<{ name: string; mediaType: string; size: number }>
  sources: AssistantSource[]
  generationId: string | null
  provider: string | null
  model: string | null
  usage: AssistantUsage | null
  estimatedCostMicros: number | null
  createdAt: string
}

export class AssistantGenerationError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message)
    this.name = 'AssistantGenerationError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_MODEL = 'openai/gpt-5.4-mini'
const DEFAULT_PRICING = {
  source: 'ai-gateway-model-catalog',
  capturedAt: '2026-08-21',
  currency: 'USD',
  unit: 'per_token',
  input: 0.00000075,
  output: 0.0000045,
  inputCacheRead: 0.000000075,
}
const LUNA_MODEL = 'openai/gpt-5.6-luna'
const LUNA_PRICING = {
  source: 'ai-gateway-model-catalog',
  capturedAt: '2026-08-21',
  currency: 'USD',
  unit: 'per_token',
  input: 0.0000002,
  output: 0.0000012,
  inputCacheRead: 0.00000002,
  variesByProvider: true,
}
const GROQ_MODEL = 'groq/openai/gpt-oss-120b'
const GROQ_PRICING = {
  source: 'groq-model-catalog',
  capturedAt: '2026-08-24',
  currency: 'USD',
  unit: 'per_token',
  input: 0.00000015,
  output: 0.0000006,
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function nullableCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function databaseError(error: { message?: string; code?: string } | null | undefined): AssistantGenerationError {
  const raw = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
  if (raw.includes('assistant_thread_not_found')) return new AssistantGenerationError('thread_not_found', 404, 'Assistant conversation not found')
  if (raw.includes('assistant_generation_not_found')) return new AssistantGenerationError('generation_not_found', 404, 'Assistant generation not found')
  if (raw.includes('assistant_generation_in_progress') || raw.includes('idx_assistant_generations_one_running')) {
    return new AssistantGenerationError('generation_in_progress', 409, 'This conversation already has a response in progress')
  }
  if (raw.includes('invalid_assistant')) return new AssistantGenerationError('invalid_assistant_request', 400, 'Assistant request is invalid')
  if (raw.includes('does not exist') || raw.includes('pgrst202') || raw.includes('42p01') || raw.includes('42883')) {
    return new AssistantGenerationError('generation_store_unavailable', 503, 'Assistant history is not available in this environment')
  }
  return new AssistantGenerationError('generation_store_unavailable', 503, 'Assistant history could not be saved')
}

export function assistantPricingSnapshot(model: string): Record<string, unknown> {
  if (model === GROQ_MODEL || model.endsWith('/openai/gpt-oss-120b')) {
    return { model: GROQ_MODEL, ...GROQ_PRICING }
  }
  if (model === LUNA_MODEL || model.endsWith('/gpt-5.6-luna') || model === 'gpt-5.6-luna') {
    return { model: LUNA_MODEL, ...LUNA_PRICING }
  }
  return model === DEFAULT_MODEL || model.endsWith('/gpt-5.4-mini') || model === 'gpt-5.4-mini'
    ? { model: DEFAULT_MODEL, ...DEFAULT_PRICING }
    : { model, source: 'unpriced', capturedAt: '2026-08-21' }
}

export function estimateAssistantCostMicros(model: string, usage: AssistantUsage): number | null {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  if (model === GROQ_MODEL || model.endsWith('/openai/gpt-oss-120b')) {
    return Math.max(0, Math.round(input * 0.15 + output * 0.6))
  }
  if (model === LUNA_MODEL || model.endsWith('/gpt-5.6-luna') || model === 'gpt-5.6-luna') {
    return Math.max(0, Math.round(input * 0.2 + output * 1.2 + cacheRead * 0.02))
  }
  if (!(model === DEFAULT_MODEL || model.endsWith('/gpt-5.4-mini') || model === 'gpt-5.4-mini')) return null
  return Math.max(0, Math.round(input * 0.75 + output * 4.5 + cacheRead * 0.075))
}

export function normalizeAssistantSources(value: unknown): AssistantSource[] {
  const unique = new Map<string, AssistantSource>()
  for (const item of safeArray(value)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = text(row.name, 160)
    const url = text(row.url, 1000)
    if (!name || !/^https?:\/\//i.test(url)) continue
    const source = {
      name,
      url,
      ...(text(row.generatedAt, 80) ? { generatedAt: text(row.generatedAt, 80) } : {}),
      ...(text(row.detail, 500) ? { detail: text(row.detail, 500) } : {}),
    }
    unique.set(`${name}|${url}`, source)
  }
  return [...unique.values()].slice(0, 30)
}

function countResult(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  for (const key of ['records', 'tasks', 'appointments', 'staleLeads']) {
    if (Array.isArray(row[key])) return row[key].length
  }
  if (row.record) return 1
  return null
}

export function buildAssistantToolTrace(toolResults: Array<{
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
}>): { trace: AssistantToolTrace[]; sources: AssistantSource[] } {
  const allSources: AssistantSource[] = []
  const trace = toolResults.slice(0, 30).map((result) => {
    const output = result.output && typeof result.output === 'object' ? result.output as Record<string, unknown> : {}
    const sources = normalizeAssistantSources(output.sources)
    allSources.push(...sources)
    return {
      toolCallId: text(result.toolCallId, 200),
      toolName: text(result.toolName, 120),
      input: result.input,
      resultCount: countResult(result.output),
      sources,
    }
  })
  return { trace, sources: normalizeAssistantSources(allSources) }
}

export async function startAssistantGeneration(input: {
  threadId?: string | null
  actorEmail: string
  actorName: string
  surface: AssistantSurface
  content: string
  attachments: Array<{ name: string; mediaType: string; size: number }>
  requestId: string
}) {
  if (input.threadId && !UUID_PATTERN.test(input.threadId)) throw new AssistantGenerationError('invalid_thread_id', 400, 'Assistant conversation is invalid')
  const { data, error } = await supabaseAdmin().rpc('start_assistant_generation_v1', {
    p_thread_id: input.threadId || null,
    p_actor_email: input.actorEmail,
    p_actor_name: input.actorName,
    p_surface: input.surface,
    p_user_content: input.content,
    p_attachments: input.attachments,
    p_request_id: input.requestId,
  })
  if (error) throw databaseError(error)
  const row = data as Record<string, unknown> | null
  const threadId = text(row?.threadId)
  const generationId = text(row?.generationId)
  if (!UUID_PATTERN.test(threadId) || !UUID_PATTERN.test(generationId)) throw new AssistantGenerationError('invalid_generation_payload', 503, 'Assistant history returned invalid data')
  return {
    created: row?.created === true,
    threadId,
    generationId,
    requestMessageId: text(row?.requestMessageId),
    responseMessageId: text(row?.responseMessageId) || null,
    status: text(row?.status),
  }
}

export async function startAssistantArtifactGeneration(input: {
  actorEmail: string
  actorName: string
  title: string
  content: string
  requestId: string
  context?: Record<string, unknown>
}) {
  const { data, error } = await supabaseAdmin().rpc('start_assistant_artifact_generation_v1', {
    p_actor_email: input.actorEmail,
    p_actor_name: input.actorName,
    p_title: input.title,
    p_user_content: input.content,
    p_request_id: input.requestId,
    p_context: input.context || {},
  })
  if (error) throw databaseError(error)
  const row = data as Record<string, unknown> | null
  const threadId = text(row?.threadId)
  const generationId = text(row?.generationId)
  if (!UUID_PATTERN.test(threadId) || !UUID_PATTERN.test(generationId)) {
    throw new AssistantGenerationError('invalid_generation_payload', 503, 'Assistant history returned invalid data')
  }
  return {
    created: row?.created === true,
    threadId,
    generationId,
    requestMessageId: text(row?.requestMessageId),
    responseMessageId: text(row?.responseMessageId) || null,
    status: text(row?.status),
  }
}

export async function completeAssistantGeneration(input: {
  generationId: string
  actorEmail: string
  content: string
  provider: string
  model: string
  finishReason: string
  usage: AssistantUsage
  toolTrace: AssistantToolTrace[]
  sources: AssistantSource[]
  metadata?: Record<string, unknown>
}) {
  const cost = estimateAssistantCostMicros(input.model, input.usage)
  const { data, error } = await supabaseAdmin().rpc('complete_assistant_generation_v1', {
    p_generation_id: input.generationId,
    p_actor_email: input.actorEmail,
    p_response_content: input.content,
    p_provider: input.provider,
    p_model: input.model,
    p_finish_reason: input.finishReason,
    p_usage: input.usage,
    p_estimated_cost_micros: cost,
    p_pricing_snapshot: assistantPricingSnapshot(input.model),
    p_tool_trace: input.toolTrace,
    p_sources: input.sources,
    p_metadata: input.metadata || {},
  })
  if (error) throw databaseError(error)
  return { ...(data as Record<string, unknown>), estimatedCostMicros: cost }
}

export async function failAssistantGeneration(input: {
  generationId: string
  actorEmail: string
  code: string
  message: string
}) {
  const { error } = await supabaseAdmin().rpc('fail_assistant_generation_v1', {
    p_generation_id: input.generationId,
    p_actor_email: input.actorEmail,
    p_error_code: input.code,
    p_error_message: input.message,
  })
  if (error) console.error('[assistant-generation] failure persistence failed', { code: error.code })
}

export async function replayAssistantGeneration(actorEmail: string, generationId: string) {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('assistant_generations')
    .select('id, thread_id, status, provider, model, finish_reason, input_tokens, output_tokens, total_tokens, cache_read_tokens, estimated_cost_micros, response_message_id')
    .eq('id', generationId)
    .eq('actor_email', actorEmail.toLowerCase())
    .maybeSingle()
  if (error) throw databaseError(error)
  if (!data) throw new AssistantGenerationError('generation_not_found', 404, 'Assistant generation not found')
  let response: { content: string; sources: unknown } | null = null
  if (data.response_message_id) {
    const { data: message, error: messageError } = await db
      .from('assistant_messages')
      .select('content,sources')
      .eq('id', data.response_message_id)
      .eq('thread_id', data.thread_id)
      .maybeSingle()
    if (messageError) throw databaseError(messageError)
    response = message
  }
  return {
    generationId: data.id,
    threadId: data.thread_id,
    responseMessageId: data.response_message_id,
    status: data.status,
    reply: response?.content || null,
    sources: normalizeAssistantSources(response?.sources),
    provider: data.provider,
    model: data.model,
    finishReason: data.finish_reason,
    usage: {
      inputTokens: nullableCount(data.input_tokens),
      outputTokens: nullableCount(data.output_tokens),
      totalTokens: nullableCount(data.total_tokens),
      cacheReadTokens: nullableCount(data.cache_read_tokens),
    },
    estimatedCostMicros: nullableCount(data.estimated_cost_micros),
  }
}

export async function listAssistantThreads(actorEmail: string, limit = 20): Promise<AssistantThreadSummary[]> {
  const { data, error } = await supabaseAdmin()
    .from('assistant_threads')
    .select('id,title,status,surface,last_message_at,created_at,updated_at')
    .eq('actor_email', actorEmail.toLowerCase())
    .order('last_message_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)))
  if (error) throw databaseError(error)
  return (data || []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as 'active' | 'archived',
    surface: row.surface as AssistantSurface,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function loadAssistantThread(actorEmail: string, threadId: string) {
  if (!UUID_PATTERN.test(threadId)) throw new AssistantGenerationError('invalid_thread_id', 400, 'Assistant conversation is invalid')
  const db = supabaseAdmin()
  const { data: thread, error: threadError } = await db
    .from('assistant_threads')
    .select('id,title,status,surface,last_message_at,created_at,updated_at')
    .eq('id', threadId)
    .eq('actor_email', actorEmail.toLowerCase())
    .maybeSingle()
  if (threadError) throw databaseError(threadError)
  if (!thread) throw new AssistantGenerationError('thread_not_found', 404, 'Assistant conversation not found')

  const [{ data: messages, error: messageError }, { data: generations, error: generationError }] = await Promise.all([
    db.from('assistant_messages')
      .select('id,role,content,attachments,sources,generation_id,created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100),
    db.from('assistant_generations')
      .select('id,provider,model,input_tokens,output_tokens,total_tokens,cache_read_tokens,estimated_cost_micros')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])
  if (messageError || generationError) throw databaseError(messageError || generationError)
  const generationMap = new Map((generations || []).map((row) => [row.id, row]))
  const storedMessages: AssistantStoredMessage[] = [...(messages || [])].reverse().map((row) => {
    const generation = row.generation_id ? generationMap.get(row.generation_id) : null
    return {
      id: row.id,
      role: row.role as AssistantStoredMessage['role'],
      content: row.content,
      attachments: safeArray(row.attachments) as AssistantStoredMessage['attachments'],
      sources: normalizeAssistantSources(row.sources),
      generationId: row.generation_id,
      provider: generation?.provider || null,
      model: generation?.model || null,
      usage: generation ? {
        inputTokens: nullableCount(generation.input_tokens),
        outputTokens: nullableCount(generation.output_tokens),
        totalTokens: nullableCount(generation.total_tokens),
        cacheReadTokens: nullableCount(generation.cache_read_tokens),
      } : null,
      estimatedCostMicros: nullableCount(generation?.estimated_cost_micros),
      createdAt: row.created_at,
    }
  })
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      status: thread.status,
      surface: thread.surface,
      lastMessageAt: thread.last_message_at,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
    } as AssistantThreadSummary,
    messages: storedMessages,
  }
}

export async function archiveAssistantThread(actorEmail: string, threadId: string) {
  if (!UUID_PATTERN.test(threadId)) throw new AssistantGenerationError('invalid_thread_id', 400, 'Assistant conversation is invalid')
  const { error } = await supabaseAdmin().rpc('archive_assistant_thread_v1', {
    p_thread_id: threadId,
    p_actor_email: actorEmail.toLowerCase(),
  })
  if (error) throw databaseError(error)
}
