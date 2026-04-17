'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { DispositionModal, DispositionType } from './disposition-modal'

export type CallStatus = 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TwilioDevice = any

interface SearchResult {
  id: string
  full_name: string
  phone: string | null
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  updated_at: string
}

interface RecentCall {
  id: string
  lead_id: string | null
  lead_name: string | null
  phone: string | null
  created_at: string
  metadata: { duration?: number } | null
}

interface DialerPanelProps {
  open: boolean
  onClose: () => void
  onStatusChange?: (status: CallStatus) => void
  pendingDial?: { phone: string; name: string; leadId: string } | null
}

function useCallTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) { setSeconds(0); return }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const stationColors: Record<string, string> = {
  intake: 'bg-blue-500/20 text-blue-300',
  qualifying: 'bg-amber-500/20 text-amber-300',
  appt_set: 'bg-purple-500/20 text-purple-300',
  negotiations: 'bg-orange-500/20 text-orange-300',
  contract_signed: 'bg-emerald-500/20 text-emerald-300',
  closed: 'bg-green-500/20 text-green-300',
  dead: 'bg-slate-500/20 text-slate-400',
}

const priorityColors: Record<string, string> = {
  hot: 'bg-red-500/20 text-red-300',
  warm: 'bg-amber-500/20 text-amber-300',
  normal: 'bg-slate-500/20 text-slate-400',
  cold: 'bg-cyan-500/20 text-cyan-300',
}

export function DialerPanel({ open, onClose, onStatusChange, pendingDial }: DialerPanelProps) {
  const [status, setStatus] = useState<CallStatus>('offline')
  const [dialNumber, setDialNumber] = useState('')
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deviceRef = useRef<TwilioDevice>(null)
  const callRef = useRef<TwilioDevice>(null)
  const callTimer = useCallTimer(status === 'on_call')
  const deviceInitialized = useRef(false)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedLead, setSelectedLead] = useState<SearchResult | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Recent calls
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([])

  // Caller ID display
  const [callerIdDisplay, setCallerIdDisplay] = useState<string>('')

  // Disposition
  const [showDisposition, setShowDisposition] = useState(false)
  const lastCallPhoneRef = useRef<string>('')

  // Handle pendingDial from ARI page click-to-call
  useEffect(() => {
    if (open && pendingDial?.phone) {
      setSelectedLead({
        id: pendingDial.leadId,
        full_name: pendingDial.name,
        phone: pendingDial.phone,
        property_address: null,
        city: null,
        station: null,
        priority: null,
        updated_at: new Date().toISOString(),
      })
      setDialNumber(pendingDial.phone)
      setSearchQuery('')
      setSearchResults([])
    }
  }, [open, pendingDial])

  function log(msg: string) {
    console.log(`[DialerPanel] ${msg}`)
  }

  const setStatusLogged = useCallback((s: CallStatus) => {
    log(`status → ${s}`)
    setStatus(s)
    onStatusChange?.(s)
  }, [onStatusChange])

  // Lazy device init on first panel open
  const initDevice = useCallback(async () => {
    if (deviceInitialized.current && deviceRef.current) return
    setStatusLogged('connecting')
    setError(null)
    try {
      log('fetching token...')
      const { Device } = await import('@twilio/voice-sdk')
      const res = await fetch('/api/twilio-token')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const { token, callerId: cid } = data
      if (cid) setCallerIdDisplay(cid)
      log('token received')

      const device = new Device(token, { logLevel: 1 })
      deviceRef.current = device

      device.on('registered', () => setStatusLogged('ready'))
      device.on('unregistered', () => setStatusLogged('offline'))
      device.on('tokenWillExpire', async () => {
        log('token expiring, refreshing...')
        try {
          const refreshRes = await fetch('/api/twilio-token')
          const refreshData = await refreshRes.json()
          if (refreshData.token) {
            device.updateToken(refreshData.token)
            if (refreshData.callerId) setCallerIdDisplay(refreshData.callerId)
            log('token refreshed')
          }
        } catch (e) {
          log('token refresh failed')
        }
      })
      device.on('error', (err: Error) => {
        log(`device error: ${err?.message}`)
        setError(err?.message || 'Device error')
        setStatusLogged('offline')
      })
      device.on('incoming', (call: TwilioDevice) => {
        log('incoming call')
        callRef.current = call
        setStatusLogged('incoming')
        call.on('disconnect', () => { callRef.current = null; setStatusLogged('ready') })
        call.on('cancel', () => { callRef.current = null; setStatusLogged('ready') })
      })

      log('registering device...')
      await device.register()
      deviceInitialized.current = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`init error: ${msg}`)
      setError(msg)
      setStatusLogged('offline')
    }
  }, [setStatusLogged])

  // Init device on first open
  useEffect(() => {
    if (open && !deviceInitialized.current) {
      initDevice()
    }
  }, [open, initDevice])

  // Auto-open panel on incoming call
  useEffect(() => {
    if (status === 'incoming' && !open) {
      // We can't directly open—parent controls this. Signal via onStatusChange.
    }
  }, [status, open])

  // Escape key to close
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && status !== 'on_call' && status !== 'calling') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose, status])

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(searchQuery.trim())}&limit=8`)
        const data = await res.json()
        setSearchResults(data.results || [])
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchQuery])

  // Load recent calls
  useEffect(() => {
    if (!open) return
    async function loadRecent() {
      try {
        const res = await fetch('/api/call-log?limit=5')
        if (res.ok) {
          const data = await res.json()
          setRecentCalls(data.calls || [])
        }
      } catch {}
    }
    loadRecent()
  }, [open])

  const callStartRef = useRef<number>(0)

  async function makeCall() {
    const number = dialNumber.trim()
    if (!number) return

    // If no Twilio device, fallback to tel: link
    if (!deviceRef.current || status === 'offline') {
      window.open(`tel:${number}`, '_self')
      return
    }

    setStatusLogged('calling')
    setError(null)
    lastCallPhoneRef.current = number
    log(`calling ${number}`)
    try {
      const call = await deviceRef.current.connect({
        params: { To: number },
      })
      callRef.current = call
      callStartRef.current = Date.now()

      call.on('ringing', () => {
        log('ringing...')
        setStatusLogged('calling')
      })
      call.on('accept', () => {
        log('call accepted')
        setStatusLogged('on_call')
      })

      fetch('/api/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: number,
          event: 'started',
          agent: 'Ernest',
          lead_id: selectedLead?.id || null,
        }),
      }).catch(() => {})

      call.on('disconnect', () => {
        const duration = Math.round((Date.now() - callStartRef.current) / 1000)
        fetch('/api/call-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: number,
            event: 'ended',
            duration,
            agent: 'Ernest',
            lead_id: selectedLead?.id || null,
          }),
        }).catch(() => {})
        callRef.current = null
        setStatusLogged('ready')
        setMuted(false)
        // Show disposition if a lead was selected
        if (selectedLead) {
          setShowDisposition(true)
        }
      })
      call.on('cancel', () => {
        callRef.current = null
        setStatusLogged('ready')
        setMuted(false)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`makeCall error: ${msg}`)
      setError(msg)
      setStatusLogged('ready')
    }
  }

  function hangup() {
    callRef.current?.disconnect()
    callRef.current = null
    setStatusLogged('ready')
    setMuted(false)
  }

  function acceptIncoming() {
    callRef.current?.accept()
    setStatusLogged('on_call')
    callStartRef.current = Date.now()
  }

  function rejectIncoming() {
    callRef.current?.reject()
    callRef.current = null
    setStatusLogged('ready')
  }

  function toggleMute() {
    if (!callRef.current) return
    callRef.current.mute(!muted)
    setMuted(!muted)
  }

  function selectLead(lead: SearchResult) {
    setSelectedLead(lead)
    setDialNumber(lead.phone || '')
    setSearchQuery('')
    setSearchResults([])
  }

  function clearSelectedLead() {
    setSelectedLead(null)
    setDialNumber('')
  }

  async function handleDisposition(disposition: DispositionType, notes?: string) {
    if (!selectedLead) return
    try {
      await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedLead.id,
          activity: {
            type: 'call',
            disposition,
            notes,
            phone: lastCallPhoneRef.current,
          },
        }),
      })
      window.dispatchEvent(new CustomEvent('crm:disposition-logged', { detail: { leadId: selectedLead.id } }))
    } catch {}
  }

  function handleRedial(call: RecentCall) {
    if (call.phone) {
      setDialNumber(call.phone)
    }
  }

  const statusDotColor: Record<CallStatus, string> = {
    offline: 'bg-slate-500',
    connecting: 'bg-yellow-400',
    ready: 'bg-emerald-400',
    calling: 'bg-blue-400',
    on_call: 'bg-emerald-400',
    incoming: 'bg-orange-400',
  }

  const statusLabel: Record<CallStatus, string> = {
    offline: 'Offline',
    connecting: 'Connecting...',
    ready: 'Ready',
    calling: 'Dialing...',
    on_call: 'On Call',
    incoming: 'Incoming',
  }

  const isOnCall = status === 'on_call' || status === 'calling'

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-[2px] transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-[70] h-full w-[420px] max-w-[calc(100vw-1rem)] bg-[#0F172A] shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <h2 className="text-white font-black text-lg tracking-tight">Dialer</h2>
            <button
              onClick={() => { deviceInitialized.current = false; initDevice() }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              title="Click to reconnect"
            >
              <div className={`w-2 h-2 rounded-full ${statusDotColor[status]} ${status === 'connecting' ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] font-bold text-white/70 uppercase tracking-wider">{statusLabel[status]}</span>
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <Icon name="close" size="text-xl" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <Icon name="error" className="text-red-400" size="text-sm" />
              <span className="text-xs text-red-300 flex-1">{error}</span>
              <button onClick={() => { setError(null); initDevice() }} className="text-[10px] font-bold text-red-300 hover:text-white uppercase">
                Retry
              </button>
            </div>
          )}

          {/* Search */}
          {!isOnCall && status !== 'incoming' && (
            <div className="relative">
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  {searching ? (
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  ) : (
                    <Icon name="search" className="text-white/40" size="text-lg" />
                  )}
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search leads by name, phone, address..."
                  className="w-full bg-white/10 text-white placeholder-white/40 rounded-lg pl-10 pr-4 py-2.5 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition-all"
                />
              </div>

              {/* Search results dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1E293B] border border-white/10 rounded-lg shadow-2xl overflow-hidden z-10 max-h-[320px] overflow-y-auto">
                  {searchResults.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => selectLead(lead)}
                      className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-bold text-white truncate">{lead.full_name}</span>
                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          {lead.priority && lead.priority !== 'normal' && (
                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${priorityColors[lead.priority] || 'bg-slate-500/20 text-slate-400'}`}>
                              {lead.priority}
                            </span>
                          )}
                          {lead.station && (
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${stationColors[lead.station] || 'bg-slate-500/20 text-slate-400'}`}>
                              {lead.station.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                      </div>
                      {lead.phone && (
                        <div className="text-xs text-white/50 font-mono">{formatPhone(lead.phone)}</div>
                      )}
                      {lead.property_address && (
                        <div className="text-xs text-white/40 truncate">{lead.property_address}{lead.city ? `, ${lead.city}` : ''}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selected Lead Context Card */}
          {selectedLead && !isOnCall && status !== 'incoming' && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-white truncate">{selectedLead.full_name}</span>
                    {selectedLead.priority && selectedLead.priority !== 'normal' && (
                      <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${priorityColors[selectedLead.priority] || ''}`}>
                        {selectedLead.priority}
                      </span>
                    )}
                    {selectedLead.station && (
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${stationColors[selectedLead.station] || ''}`}>
                        {selectedLead.station.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  {selectedLead.property_address && (
                    <p className="text-xs text-white/50 truncate">{selectedLead.property_address}{selectedLead.city ? `, ${selectedLead.city}` : ''}</p>
                  )}
                  <a
                    href={`/leads/${selectedLead.id}`}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 mt-1.5 transition-colors"
                  >
                    View Lead <Icon name="arrow_forward" size="text-xs" />
                  </a>
                </div>
                <button
                  onClick={clearSelectedLead}
                  className="p-1 text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
                >
                  <Icon name="close" size="text-sm" />
                </button>
              </div>
            </div>
          )}

          {/* Incoming Call UI */}
          {status === 'incoming' && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-5 animate-pulse">
              <div className="text-center mb-4">
                <div className="w-14 h-14 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Icon name="call" className="text-orange-400" size="text-2xl" />
                </div>
                <p className="text-white font-bold text-lg">Incoming Call</p>
                <p className="text-white/50 text-sm">Unknown Caller</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={acceptIncoming}
                  className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="call" size="text-lg" />
                  Accept
                </button>
                <button
                  onClick={rejectIncoming}
                  className="flex-1 py-3 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="call_end" size="text-lg" />
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Active Call Card */}
          {isOnCall && (
            <div className={`rounded-xl p-5 border-2 transition-all ${status === 'on_call' ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-blue-500/5 border-blue-500/30'}`}
              style={status === 'on_call' ? { animation: 'pulse-border 2s ease-in-out infinite' } : undefined}
            >
              <div className="text-center mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-2 ${status === 'on_call' ? 'bg-emerald-500/20' : 'bg-blue-500/20'}`}>
                  <Icon name="call" className={status === 'on_call' ? 'text-emerald-400' : 'text-blue-400'} size="text-2xl" />
                </div>
                {selectedLead && (
                  <p className="text-white font-bold text-base">{selectedLead.full_name}</p>
                )}
                <p className="text-white/60 font-mono text-sm">{dialNumber}</p>
                {status === 'on_call' && (
                  <p className="text-emerald-400 font-mono text-xl font-bold mt-1">{callTimer}</p>
                )}
                {status === 'calling' && (
                  <p className="text-blue-400 text-sm mt-1 animate-pulse">Dialing...</p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={toggleMute}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                    muted ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  <Icon name={muted ? 'mic_off' : 'mic'} size="text-lg" />
                  {muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={hangup}
                  className="flex-1 py-2.5 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="call_end" size="text-lg" />
                  Hang Up
                </button>
              </div>
            </div>
          )}

          {/* Dial Section (when not on call and not incoming) */}
          {!isOnCall && status !== 'incoming' && (
            <div className="space-y-3">
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <Icon name="call" className="text-white/30" size="text-lg" />
                </span>
                <input
                  type="tel"
                  value={dialNumber}
                  onChange={(e) => setDialNumber(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && makeCall()}
                  placeholder="+1 (816) 555-0000"
                  className="w-full bg-white/5 text-white placeholder-white/30 rounded-lg pl-10 pr-4 py-3 text-lg font-mono tracking-wider border border-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition-all"
                />
              </div>
              {callerIdDisplay && (
                <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/40 font-medium">
                  <Icon name="phone_forwarded" size="text-xs" />
                  <span>Calling from: {TWILIO_NUMBERS.find(n => n.value === callerIdDisplay)?.label || formatPhone(callerIdDisplay)}</span>
                </div>
              )}
              <button
                onClick={makeCall}
                disabled={!dialNumber.trim() || status === 'connecting'}
                className="w-full py-3.5 bg-emerald-500 text-white font-black rounded-lg hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
              >
                <Icon name="call" size="text-lg" />
                {status === 'offline' ? 'Call (Phone)' : 'Call'}
              </button>
            </div>
          )}

          {/* Recent Calls (when idle) */}
          {!isOnCall && status !== 'incoming' && recentCalls.length > 0 && (
            <div>
              <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2">Recent Calls</h3>
              <div className="space-y-1">
                {recentCalls.map((call) => (
                  <button
                    key={call.id}
                    onClick={() => handleRedial(call)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                      <Icon name="call" className="text-white/30" size="text-sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/80 font-medium truncate">
                        {call.lead_name || call.phone || 'Unknown'}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/30">{formatTimeAgo(call.created_at)}</span>
                        {call.metadata?.duration && (
                          <span className="text-[10px] text-white/30">{formatDuration(call.metadata.duration)}</span>
                        )}
                      </div>
                    </div>
                    <Icon name="call" className="text-white/20" size="text-sm" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reconnect button when offline */}
          {status === 'offline' && !error && (
            <button
              onClick={initDevice}
              className="w-full py-2.5 bg-white/5 text-white/50 font-bold rounded-lg hover:bg-white/10 transition-colors flex items-center justify-center gap-2 text-xs border border-white/10"
            >
              <Icon name="refresh" size="text-sm" />
              Connect Twilio
            </button>
          )}
        </div>
      </div>

      {/* Pulsing border animation */}
      <style jsx>{`
        @keyframes pulse-border {
          0%, 100% { border-color: rgba(16, 185, 129, 0.3); }
          50% { border-color: rgba(16, 185, 129, 0.6); }
        }
      `}</style>

      {/* Disposition Modal */}
      <DispositionModal
        open={showDisposition}
        onClose={() => setShowDisposition(false)}
        onDisposition={handleDisposition}
        phoneNumber={lastCallPhoneRef.current}
        leadName={selectedLead?.full_name}
      />
    </>
  )
}

// Re-export for backwards compat if anything imported TelephonyBar
export { DialerPanel as TelephonyBar }
