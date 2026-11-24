'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { sourceProspectPhoneId, type HeirPhone } from '@/lib/heir-dialer-queue'

/**
 * Per-phone voice hold. Blocks outbound voice only (dialer eligibility reason
 * 'voice_hold'); never touches SMS opt-out. Brand red when on.
 */
export function VoiceHoldButton({ phone, readOnly }: { phone: HeirPhone; readOnly: boolean }) {
  const prospectPhoneId = sourceProspectPhoneId(phone)
  const [held, setHeld] = useState(Boolean(phone.voice_hold))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!prospectPhoneId) return null

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/heirs/voice-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_phone_id: prospectPhoneId, hold: !held, prospect_id: phone.prospect_id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not update voice hold')
      setHeld(!held)
      if (data?.warning) setError(data.warning)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update voice hold')
    } finally {
      setBusy(false)
    }
  }

  const reason = phone.voice_hold_reason ? ` (${phone.voice_hold_reason})` : ''
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={readOnly || busy}
      className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors border ${
        held
          ? 'bg-[#C8242D]/15 border-[#C8242D]/40 text-[#E04A52] hover:bg-[#C8242D]/25'
          : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
      } disabled:cursor-not-allowed disabled:opacity-50`}
      title={error ?? (held ? `Voice hold on${reason}. Click to clear. SMS is not affected.` : 'Put this number on voice hold (blocks calls, not texts)')}
      aria-label={held ? 'Clear voice hold' : 'Set voice hold'}
      aria-pressed={held}
    >
      <Icon name="phone_paused" size="text-sm" filled={held} />
    </button>
  )
}
