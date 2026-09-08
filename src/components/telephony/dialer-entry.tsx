'use client'

import { ProspectingDialerRail } from '@/components/prospecting/prospecting-dialer-rail'
import { CrmDialerModal } from '@/components/telephony/crm-dialer-modal'
import type { DialerPanelProps } from '@/components/telephony/telephony-bar-types'
import type { InteractiveDialerSurface } from '@/lib/telephony/dialer-surface'

type DialerEntryProps = Omit<DialerPanelProps, 'surface' | 'presentation'> & {
  surface: InteractiveDialerSurface
}

export function DialerEntry({ surface, ...props }: DialerEntryProps) {
  if (surface === 'prospecting') {
    return <ProspectingDialerRail {...props} />
  }

  return <CrmDialerModal {...props} />
}
