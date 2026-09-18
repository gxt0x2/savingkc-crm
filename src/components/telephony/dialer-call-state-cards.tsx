'use client'

import { formatPhone } from '@/lib/format'
import { Icon } from '@/components/ui/icon'

type IncomingCallCardProps = {
  onAccept: () => void
  onReject: () => void
  workspace?: boolean
}

export function IncomingCallCard({ onAccept, onReject, workspace = false }: IncomingCallCardProps) {
  return <div className={`animate-pulse rounded-[6px] border p-5 ${workspace ? 'border-[var(--prospecting-danger)] bg-[var(--prospecting-danger-soft)]' : 'border-[#7D2626] bg-[#1A1616]'}`}>
    <div className="mb-4 text-center">
      <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[6px] ${workspace ? 'bg-[var(--prospecting-danger-soft)]' : 'bg-[#E32E2E]/20'}`}>
        <Icon name="call" className={workspace ? 'text-[var(--prospecting-danger)]' : 'text-[#FF7A7A]'} size="text-2xl" />
      </div>
      <p className={`text-lg font-bold ${workspace ? 'text-[var(--ck-text)]' : 'text-white'}`}>Incoming Call</p>
      <p className={`text-sm ${workspace ? 'text-[var(--ck-text-muted)]' : 'text-white/50'}`}>Unknown Caller</p>
    </div>
    <div className="flex gap-3">
      <button type="button" onClick={onAccept} className={`flex flex-1 items-center justify-center gap-2 rounded-[6px] py-3 font-bold transition-colors ${workspace ? 'bg-[var(--prospecting-success)] text-[var(--prospecting-on-success)] hover:bg-[var(--prospecting-success-strong)]' : 'bg-white text-black hover:bg-white/90'}`}>
        <Icon name="call" size="text-lg" /> Accept
      </button>
      <button type="button" onClick={onReject} className={`flex flex-1 items-center justify-center gap-2 rounded-[6px] py-3 font-bold text-white transition-colors ${workspace ? 'bg-[var(--crm-brand)] hover:bg-[var(--crm-brand-hover)]' : 'bg-[#E32E2E] hover:bg-[#C42626]'}`}>
        <Icon name="call_end" size="text-lg" /> Reject
      </button>
    </div>
  </div>
}

type ActiveCallCardProps = {
  callTimer: string
  dialNumber: string
  leadName?: string
  muted: boolean
  onHangup: () => void
  onToggleMute: () => void
  status: 'calling' | 'on_call'
  workspace?: boolean
}

export function ActiveCallCard({ callTimer, dialNumber, leadName, muted, onHangup, onToggleMute, status, workspace = false }: ActiveCallCardProps) {
  const connected = status === 'on_call'
  return <div
    className={`rounded-[6px] border p-5 transition-all ${workspace ? connected ? 'border-[var(--prospecting-success)] bg-[var(--prospecting-success-soft)]' : 'border-[var(--prospecting-info)] bg-[var(--prospecting-info-soft)]' : connected ? 'border-[#7D2626] bg-[#191417]' : 'border-[#2F2F38] bg-[#18181E]'}`}
    style={connected ? { animation: 'pulse-border 2s ease-in-out infinite' } : undefined}
  >
    <div className="mb-4 text-center">
      <div className={`mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-[6px] ${workspace ? connected ? 'bg-[var(--prospecting-success-soft)]' : 'bg-[var(--prospecting-primary-soft)]' : connected ? 'bg-[#E32E2E]/20' : 'bg-white/10'}`}>
        <Icon name="call" className={workspace ? connected ? 'text-[var(--prospecting-success)]' : 'text-[var(--prospecting-primary)]' : connected ? 'text-[#FF7A7A]' : 'text-white'} size="text-2xl" />
      </div>
      {leadName ? <p className={`text-base font-bold ${workspace ? 'text-[var(--ck-text)]' : 'text-white'}`}>{leadName}</p> : null}
      <p className={`font-mono text-sm ${workspace ? 'text-[var(--ck-text-muted)]' : 'text-white/60'}`}>{formatPhone(dialNumber)}</p>
      {connected ? <p className={`mt-1 font-mono text-xl font-bold ${workspace ? 'text-[var(--prospecting-success)]' : 'text-[#FF7A7A]'}`}>{callTimer}</p> : <p className={`mt-1 animate-pulse text-sm ${workspace ? 'text-[var(--prospecting-primary)]' : 'text-white/80'}`}>Dialing...</p>}
    </div>
    <div className="flex gap-3">
      <button type="button" onClick={onToggleMute} className={`flex flex-1 items-center justify-center gap-2 rounded-[6px] py-2.5 text-sm font-bold transition-colors ${muted ? workspace ? 'border border-[var(--prospecting-danger)] bg-[var(--prospecting-danger-soft)] text-[var(--prospecting-danger)]' : 'border border-red-500/30 bg-red-500/20 text-red-300' : workspace ? 'border border-[var(--prospecting-border)] bg-[var(--prospecting-elevated)] text-[var(--ck-text)] hover:bg-[var(--prospecting-hover)]' : 'border border-[#31313A] bg-[#1E1E25] text-white/75 hover:bg-[#272730]'}`}>
        <Icon name={muted ? 'mic_off' : 'mic'} size="text-lg" /> {muted ? 'Unmute' : 'Mute'}
      </button>
      <button type="button" onClick={onHangup} className={`flex flex-1 items-center justify-center gap-2 rounded-[6px] py-2.5 font-bold text-white transition-colors ${workspace ? 'bg-[var(--crm-brand)] hover:bg-[var(--crm-brand-hover)]' : 'bg-[#E32E2E] hover:bg-[#C42626]'}`}>
        <Icon name="call_end" size="text-lg" /> Hang Up
      </button>
    </div>
  </div>
}
