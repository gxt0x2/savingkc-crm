import { dehydrate, HydrationBoundary } from '@tanstack/react-query'

import { createConversationWorkspaceQueryClient } from '@/lib/server/conversation-workspace-prefetch'

export const dynamic = 'force-dynamic'

export default async function ConversationsLayout({ children }: { children: React.ReactNode }) {
  const queryClient = await createConversationWorkspaceQueryClient()
  if (!queryClient) return children

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>
}
