import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { CrmApiError, createMobileRequestId, fetchLatestAssistantThread, sendMobileAssistantMessage } from '../lib/api'
import type { AssistantMessage } from '../types'

const QUICK_PROMPTS = [
  'What needs my attention today?',
  'Which assigned seller should I contact next, and why?',
  'Summarize the conversations that need a reply.',
]

const INTRO = "ARI checks SavingKC's live CRM records and approved operating path before answering. It can research and recommend, but it cannot change CRM data from this screen."

function optimisticMessage(content: string): AssistantMessage {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content,
    sources: [],
    createdAt: new Date().toISOString(),
  }
}

export function AssistantScreen({
  accessToken,
  ownerEmail,
  initialPrompt,
  onInitialPromptConsumed,
}: {
  accessToken: string
  ownerEmail: string
  initialPrompt: string | null
  onInitialPromptConsumed: () => void
}) {
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryRequest, setRetryRequest] = useState<{ content: string; requestId: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    setError(null)
    void fetchLatestAssistantThread({ accessToken })
      .then((history) => {
        if (cancelled || !history) return
        setThreadId(history.thread.id)
        setMessages(history.messages.filter((message) => message.role === 'user' || message.role === 'assistant'))
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'ARI history is unavailable.')
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [accessToken])

  useEffect(() => {
    if (!initialPrompt) return
    setDraft(initialPrompt)
    onInitialPromptConsumed()
  }, [initialPrompt, onInitialPromptConsumed])

  async function send() {
    const content = draft.trim()
    if (!content || sending || loadingHistory) return

    const requestId = retryRequest?.content === content ? retryRequest.requestId : createMobileRequestId()
    const pending = optimisticMessage(content)
    setDraft('')
    setError(null)
    setSending(true)
    setMessages((current) => [...current, pending])
    try {
      const result = await sendMobileAssistantMessage({ accessToken, threadId, content, requestId })
      setRetryRequest(null)
      setThreadId(result.threadId)
      setMessages((current) => [...current, {
        id: result.responseMessageId,
        role: 'assistant',
        content: result.reply,
        sources: result.sources || [],
        createdAt: new Date().toISOString(),
      }])
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== pending.id))
      setDraft(content)
      setRetryRequest(!(cause instanceof CrmApiError) || cause.status === 409 ? { content, requestId } : null)
      setError(cause instanceof Error ? cause.message : 'ARI could not complete the request.')
    } finally {
      setSending(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.avatar}><Text style={styles.avatarText}>ARI</Text></View>
          <View style={styles.titleCopy}>
            <Text style={styles.title}>AI Assistant</Text>
            <Text style={styles.status}>Private to {ownerEmail} · live CRM context</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptRow}>
          {QUICK_PROMPTS.map((prompt) => (
            <Pressable
              accessibilityRole="button"
              disabled={sending || loadingHistory}
              key={prompt}
              onPress={() => setDraft(prompt)}
              style={styles.promptButton}
            >
              <Text style={styles.promptText}>{prompt}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.transcript}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loadingHistory ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.meta}>Loading your ARI conversation…</Text></View> : null}
        {!loadingHistory && messages.length === 0 ? <AssistantBubble message={{
          id: 'intro', role: 'assistant', content: INTRO, sources: [], createdAt: new Date(0).toISOString(),
        }} /> : null}
        {messages.map((message) => <AssistantBubble key={message.id} message={message} />)}
        {sending ? <View style={[styles.bubble, styles.assistantBubble]}><Text style={styles.meta}>Checking goals, live CRM, and the approved workflow…</Text></View> : null}
        {error ? <View style={styles.errorCard}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></View> : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Ask ARI"
          editable={!sending && !loadingHistory}
          multiline
          onChangeText={setDraft}
          placeholder="Ask what needs attention or what happens next…"
          style={styles.input}
          value={draft}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!draft.trim() || sending || loadingHistory}
          onPress={() => void send()}
          style={[styles.sendButton, (!draft.trim() || sending || loadingHistory) && styles.disabled]}
        >
          <Text style={styles.sendText}>{sending ? 'Working…' : 'Ask ARI'}</Text>
        </Pressable>
        <Text style={styles.disclaimer}>ARI proposes actions only. Calls, messages, assignments, stages, deletes, routing, and spend require confirmation.</Text>
      </View>
    </KeyboardAvoidingView>
  )
}

function AssistantBubble({ message }: { message: AssistantMessage }) {
  const user = message.role === 'user'
  return <View style={[styles.bubble, user ? styles.userBubble : styles.assistantBubble]}>
    <Text style={[styles.message, user && styles.userMessage]}>{message.content}</Text>
    {!user && message.sources.length > 0 ? <View style={styles.sources}>
      <Text style={styles.sourceHeading}>CRM sources</Text>
      {message.sources.slice(0, 4).map((source) => (
        <View key={`${source.name}-${source.url}`} style={styles.sourceRow}>
          <Text style={styles.sourceName}>{source.name}</Text>
          {source.detail ? <Text style={styles.sourceDetail}>{source.detail}</Text> : null}
        </View>
      ))}
    </View> : null}
  </View>
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { gap: 12, paddingBottom: 12 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  avatar: { alignItems: 'center', backgroundColor: '#7C3AED', borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  avatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  titleCopy: { flex: 1, gap: 2 },
  title: { color: '#111827', fontSize: 25, fontWeight: '900' },
  status: { color: '#15803D', fontSize: 12, fontWeight: '800' },
  promptRow: { gap: 8, paddingRight: 12 },
  promptButton: { backgroundColor: '#F3E8FF', borderColor: '#DDD6FE', borderRadius: 999, borderWidth: 1, maxWidth: 230, paddingHorizontal: 12, paddingVertical: 8 },
  promptText: { color: '#6D28D9', fontSize: 12, fontWeight: '800' },
  transcript: { gap: 10, paddingBottom: 14 },
  loading: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingVertical: 20 },
  bubble: { borderRadius: 15, gap: 10, maxWidth: '92%', paddingHorizontal: 14, paddingVertical: 11 },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderColor: '#D8E0EB', borderWidth: 1 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#7C3AED' },
  message: { color: '#111827', fontSize: 14, lineHeight: 21 },
  userMessage: { color: '#FFFFFF' },
  meta: { color: '#64748B', fontSize: 13, lineHeight: 19 },
  sources: { borderTopColor: '#E2E8F0', borderTopWidth: 1, gap: 7, paddingTop: 9 },
  sourceHeading: { color: '#475569', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  sourceRow: { gap: 2 },
  sourceName: { color: '#6D28D9', fontSize: 12, fontWeight: '800' },
  sourceDetail: { color: '#64748B', fontSize: 11, lineHeight: 16 },
  errorCard: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', borderRadius: 12, borderWidth: 1, padding: 12 },
  error: { color: '#B91C1C', fontSize: 13, fontWeight: '700' },
  composer: { borderTopColor: '#D8E0EB', borderTopWidth: 1, gap: 9, paddingBottom: 10, paddingTop: 12 },
  input: { backgroundColor: '#FFFFFF', borderColor: '#CBD5E1', borderRadius: 12, borderWidth: 1, color: '#111827', fontSize: 16, minHeight: 70, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' },
  sendButton: { alignItems: 'center', backgroundColor: '#7C3AED', borderRadius: 10, minHeight: 43, justifyContent: 'center' },
  sendText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  disclaimer: { color: '#64748B', fontSize: 10, lineHeight: 14, textAlign: 'center' },
  disabled: { opacity: 0.45 },
})
