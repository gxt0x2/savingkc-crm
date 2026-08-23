'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { Icon } from '@/components/ui/icon'

export function DialerRouteGate({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const hasExecutionContext = Boolean(
    searchParams.get('session_id')?.trim()
    || searchParams.get('lead_ids')?.trim()
    || searchParams.get('cohort')?.trim(),
  )

  useEffect(() => {
    if (!hasExecutionContext) router.replace('/prospecting')
  }, [hasExecutionContext, router])

  if (!hasExecutionContext) {
    return <div className="flex min-h-[70vh] items-center justify-center" role="status"><Icon name="progress_activity" className="!text-4xl animate-spin text-[var(--ck-text-dim)]" /><span className="sr-only">Opening Prospecting</span></div>
  }

  return children
}
