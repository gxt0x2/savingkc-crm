'use client'

import { SoftphoneCore } from '@/components/telephony/telephony-bar'
import type { DialerPanelProps } from '@/components/telephony/telephony-bar-types'

export type ProspectingDialerRailProps = Omit<DialerPanelProps, 'surface' | 'presentation'> & {
  pendingSessionId?: string | null
}

export function ProspectingDialerRail(props: ProspectingDialerRailProps) {
  return <SoftphoneCore {...props} surface="prospecting" presentation="workspace" />
}
