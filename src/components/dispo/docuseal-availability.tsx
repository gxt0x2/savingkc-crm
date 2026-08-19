'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { DOCUSEAL_UNAVAILABLE_MESSAGE } from '@/lib/docuseal-availability'

interface AvailabilityState {
  enabled: boolean
  checking: boolean
}

export function useDocusealAvailability(): AvailabilityState {
  const [state, setState] = useState<AvailabilityState>({ enabled: false, checking: true })

  useEffect(() => {
    let active = true

    fetch('/api/docuseal/status', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('DocuSeal status is unavailable')
        return response.json() as Promise<{ enabled?: boolean }>
      })
      .then((data) => {
        if (active) setState({ enabled: data.enabled === true, checking: false })
      })
      .catch(() => {
        if (active) setState({ enabled: false, checking: false })
      })

    return () => {
      active = false
    }
  }, [])

  return state
}

export function DocusealUnavailableNotice({ checking = false }: { checking?: boolean }) {
  const label = checking ? 'Checking assignment service…' : 'Assignment signing temporarily unavailable'

  return (
    <span
      role="status"
      title={checking ? label : DOCUSEAL_UNAVAILABLE_MESSAGE}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 py-2 text-sm font-bold text-[var(--crm-warning)]"
    >
      <Icon name={checking ? 'hourglass_top' : 'pause_circle'} size="text-sm" />
      {label}
    </span>
  )
}
