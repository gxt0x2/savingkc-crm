import type { AssistantSource, AssistantStoredMessage, AssistantSurface, AssistantThreadSummary } from '@/lib/ai/generation-store'

export type AssistantClientMessage = Pick<AssistantStoredMessage, 'id' | 'role' | 'content' | 'attachments' | 'sources' | 'provider' | 'model' | 'usage' | 'estimatedCostMicros' | 'createdAt'>

type CommandResponse = {
  reply: string
  threadId: string
  generationId: string
  responseMessageId: string
  sources: AssistantSource[]
  provider: string | null
  model: string | null
  usage: AssistantStoredMessage['usage']
  estimatedCostMicros: number | null
  error?: string
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

export async function loadLatestAssistantThread() {
  const threadResponse = await fetch('/api/ai/threads?limit=20', { cache: 'no-store' })
  const threadPayload = await responseJson(threadResponse)
  if (!threadResponse.ok) throw new Error(typeof threadPayload.error === 'string' ? threadPayload.error : 'Assistant history is unavailable.')
  const threads = Array.isArray(threadPayload.threads) ? threadPayload.threads as AssistantThreadSummary[] : []
  const active = threads.find((thread) => thread.status === 'active')
  if (!active) return { thread: null, messages: [] as AssistantClientMessage[] }
  const response = await fetch(`/api/ai/threads/${encodeURIComponent(active.id)}`, { cache: 'no-store' })
  const payload = await responseJson(response)
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Assistant history is unavailable.')
  return payload as unknown as { thread: AssistantThreadSummary; messages: AssistantClientMessage[] }
}

export async function sendAssistantMessage(input: {
  threadId: string | null
  surface: AssistantSurface
  requestId: string
  content: string
  attachments: Array<{ name: string; mediaType: string; size: number; dataUrl: string }>
}): Promise<CommandResponse> {
  const response = await fetch('/api/ai/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadId: input.threadId,
      surface: input.surface,
      requestId: input.requestId,
      messages: [{ role: 'user', content: input.content }],
      attachments: input.attachments,
    }),
  })
  const payload = await responseJson(response)
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'The AI Assistant could not complete the request.')
  return payload as unknown as CommandResponse
}

export async function archiveAssistantConversation(threadId: string) {
  const response = await fetch(`/api/ai/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'archive' }),
  })
  const payload = await responseJson(response)
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'The conversation could not be archived.')
}
