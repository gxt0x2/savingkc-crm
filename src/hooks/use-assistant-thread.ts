'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  archiveAssistantConversation,
  loadLatestAssistantThread,
  sendAssistantMessage,
  type AssistantClientMessage,
} from '@/lib/ai/assistant-client'
import type { AssistantSurface } from '@/lib/ai/generation-store'

type Attachment = { name: string; mediaType: string; size: number; dataUrl: string }

function optimisticMessage(content: string, attachments: Attachment[]): AssistantClientMessage {
  return {
    id: `pending-${crypto.randomUUID()}`,
    role: 'user',
    content,
    attachments: attachments.map(({ name, mediaType, size }) => ({ name, mediaType, size })),
    sources: [],
    provider: null,
    model: null,
    usage: null,
    estimatedCostMicros: null,
    createdAt: new Date().toISOString(),
  }
}

export function useAssistantThread(surface: AssistantSurface) {
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AssistantClientMessage[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadLatestAssistantThread()
      .then((result) => {
        if (cancelled) return
        setThreadId(result.thread?.id || null)
        setMessages(result.messages)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Assistant history is unavailable.')
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => { cancelled = true }
  }, [])

  const send = useCallback(async (content: string, attachments: Attachment[] = []) => {
    const clean = content.trim()
    if (!clean || sending || loadingHistory) return false
    const requestId = crypto.randomUUID()
    setMessages((current) => [...current, optimisticMessage(clean, attachments)])
    setSending(true)
    setError('')
    try {
      const result = await sendAssistantMessage({ threadId, surface, requestId, content: clean, attachments })
      setThreadId(result.threadId)
      setMessages((current) => [...current, {
        id: result.responseMessageId,
        role: 'assistant',
        content: result.reply,
        attachments: [],
        sources: result.sources || [],
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        estimatedCostMicros: result.estimatedCostMicros,
        createdAt: new Date().toISOString(),
      }])
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The AI Assistant could not complete the request.')
      return false
    } finally {
      setSending(false)
    }
  }, [loadingHistory, sending, surface, threadId])

  const clear = useCallback(async () => {
    if (sending) return false
    setError('')
    try {
      if (threadId) await archiveAssistantConversation(threadId)
      setThreadId(null)
      setMessages([])
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The conversation could not be archived.')
      return false
    }
  }, [sending, threadId])

  return { threadId, messages, loadingHistory, sending, error, setError, send, clear }
}
