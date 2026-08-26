'use client'

import { Icon } from '@/components/ui/icon'

type IncomingCallCardProps = {
  onAccept: () => void
  onReject: () => void
}

export function IncomingCallCard({ onAccept, onReject }: IncomingCallCardProps) {
  return <div className="animate-pulse rounded-[6px] border border-[#7D2626] bg-[#1A1616] p-5">
    <div className="mb-4 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[6px] bg-[#E32E2E]/20">
        <Icon name="call" className="text-[#FF7A7A]" size="text-2xl" />
      </div>
      <p className="text-lg font-bold text-white">Incoming Call</p>
      <p className="text-sm text-white/50">Unknown Caller</p>
    </div>
    <div className="flex gap-3">
      <button type="button" onClick={onAccept} className="flex flex-1 items-center justify-center gap-2 rounded-[6px] bg-white py-3 font-bold text-black transition-colors hover:bg-white/90">
        <Icon name="call" size="text-lg" /> Accept
      </button>
      <button type="button" onClick={onReject} className="flex flex-1 items-center justify-center gap-2 rounded-[6px] bg-[#E32E2E] py-3 font-bold text-white transition-colors hover:bg-[#C42626]">
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
}

export function ActiveCallCard({ callTimer, dialNumber, leadName, muted, onHangup, onToggleMute, status }: ActiveCallCardProps) {
  const connected = status === 'on_call'
  return <div
    className={`rounded-[6px] border p-5 transition-all ${connected ? 'border-[#7D2626] bg-[#191417]' : 'border-[#2F2F38] bg-[#18181E]'}`}
    style={connected ? { animation: 'pulse-border 2s ease-in-out infinite' } : undefined}
  >
    <div className="mb-4 text-center">
      <div className={`mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-[6px] ${connected ? 'bg-[#E32E2E]/20' : 'bg-white/10'}`}>
        <Icon name="call" className={connected ? 'text-[#FF7A7A]' : 'text-white'} size="text-2xl" />
      </div>
      {leadName ? <p className="text-base font-bold text-white">{leadName}</p> : null}
      <p className="font-mono text-sm text-white/60">{dialNumber}</p>
      {connected ? <p className="mt-1 font-mono text-xl font-bold text-[#FF7A7A]">{callTimer}</p> : <p className="mt-1 animate-pulse text-sm text-white/80">Dialing...</p>}
    </div>
    <div className="flex gap-3">
      <button type="button" onClick={onToggleMute} className={`flex flex-1 items-center justify-center gap-2 rounded-[6px] py-2.5 text-sm font-bold transition-colors ${muted ? 'border border-red-500/30 bg-red-500/20 text-red-300' : 'border border-[#31313A] bg-[#1E1E25] text-white/75 hover:bg-[#272730]'}`}>
        <Icon name={muted ? 'mic_off' : 'mic'} size="text-lg" /> {muted ? 'Unmute' : 'Mute'}
      </button>
      <button type="button" onClick={onHangup} className="flex flex-1 items-center justify-center gap-2 rounded-[6px] bg-[#E32E2E] py-2.5 font-bold text-white transition-colors hover:bg-[#C42626]">
        <Icon name="call_end" size="text-lg" /> Hang Up
      </button>
    </div>
  </div>
}
