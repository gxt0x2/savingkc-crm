'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useEffect, useState, type ReactNode } from 'react'
import { AuthProvider } from '@/lib/auth-context'

const PushManager = dynamic(
  () => import('@/components/push-manager').then((module) => module.PushManager),
  { ssr: false },
)

export function Providers({ children }: { children: ReactNode }) {
  const [pushReady, setPushReady] = useState(false)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
        },
      })
  )

  useEffect(() => {
    // Service-worker registration and subscription discovery are background
    // work. They must never compete with the active route's first paint.
    const timeoutId = window.setTimeout(() => setPushReady(true), 8_000)
    return () => window.clearTimeout(timeoutId)
  }, [])

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        {pushReady ? <PushManager /> : null}
        {children}
      </QueryClientProvider>
    </AuthProvider>
  )
}
