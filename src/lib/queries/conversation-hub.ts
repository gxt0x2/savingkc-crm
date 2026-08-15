export const conversationHubQueryKey = ['conversation-hub'] as const
export const conversationHubStaleTime = 5 * 60 * 1000

export async function fetchConversationHub<T, A = never>(): Promise<{ items: T[]; unmatchedActivities: A[] }> {
  const response = await fetch('/api/conversations/hub', { cache: 'no-store' })
  if (!response.ok) throw new Error('Conversation state could not be loaded')
  const payload = await response.json() as { items?: T[]; unmatchedActivities?: A[] }
  return { items: payload.items ?? [], unmatchedActivities: payload.unmatchedActivities ?? [] }
}
