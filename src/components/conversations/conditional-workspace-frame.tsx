'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useAppMode } from '@/hooks/use-app-mode'
import { WorkspaceFrame } from './workspace-frame'

export function ConditionalWorkspaceFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { mode } = useAppMode()
  const acquisitionsCalendar =
    pathname.startsWith('/calendar') &&
    (searchParams.get('department') === 'acquisitions' || (!searchParams.get('department') && mode === 'acquisitions'))
  const acquisitionsSettings =
    pathname.startsWith('/settings') &&
    searchParams.get('portal') !== 'tc' &&
    mode !== 'tc'

  return acquisitionsCalendar || acquisitionsSettings
    ? <WorkspaceFrame>{children}</WorkspaceFrame>
    : children
}
