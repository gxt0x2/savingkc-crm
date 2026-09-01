import { getTwilioClient } from '@/lib/safe-communications'

export type ProviderDisconnectResult = 'not_required' | 'disconnected' | 'already_ended' | 'unconfirmed'

function providerErrorField(error: unknown, field: 'code' | 'status'): unknown {
  return typeof error === 'object' && error !== null && field in error
    ? (error as Record<typeof field, unknown>)[field]
    : undefined
}

export async function disconnectProviderCallForTakeover(
  providerCallSid: string | null | undefined,
): Promise<ProviderDisconnectResult> {
  const sid = providerCallSid?.trim() || ''
  if (!sid) return 'not_required'
  if (!/^CA[0-9a-f]{32}$/i.test(sid)) {
    console.error('[dialer/session-takeover] Refusing malformed provider call SID')
    return 'unconfirmed'
  }

  const client = getTwilioClient()
  if (!client) {
    console.error('[dialer/session-takeover] Twilio client unavailable while disconnecting prior call', { sid })
    return 'unconfirmed'
  }

  try {
    await client.calls(sid).update({ status: 'completed' })
    return 'disconnected'
  } catch (error) {
    const code = providerErrorField(error, 'code')
    const status = providerErrorField(error, 'status')
    if (code === 20404 || status === 404) return 'already_ended'
    console.error('[dialer/session-takeover] Twilio did not confirm prior call disconnect', {
      sid,
      code: typeof code === 'number' ? code : null,
      status: typeof status === 'number' ? status : null,
    })
    return 'unconfirmed'
  }
}
