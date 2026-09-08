'use client'

import { SoftphoneCore } from '@/components/telephony/telephony-bar'
import type { DialerPanelProps } from '@/components/telephony/telephony-bar-types'

export type CrmDialerModalProps = Omit<DialerPanelProps, 'surface' | 'presentation' | 'pendingSessionId'>

export function CrmDialerModal(props: CrmDialerModalProps) {
  return <SoftphoneCore {...props} surface="crm" presentation="modal" pendingSessionId={null} />
}
