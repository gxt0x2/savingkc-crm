export const conversationHubQueryKey = ['conversation-hub'] as const

export async function fetchConversationHub<T>(): Promise<{ items: T[] }> {
  const response = await fetch('/api/conversations/hub', { cache: 'no-store' })
  if (!response.ok) throw new Error('Conversation state could not be loaded')
  const payload = await response.json() as { items?: T[] }
  return { items: payload.items ?? [] }
}
