'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatPhone, toProperCase } from '@/lib/format'
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
  agent: string | null
  phone: string | null
  from: string | null
  to: string | null
  direction: string | null
  outcome: string | null
  duration: number | null
  created_at: string
  metadata: { duration?: number; callStatus?: string; status?: string; outcome?: string; direction?: string } | null
}

// A single entry in the heir-dialer queue. The property stays pinned (leadId +
// propertyAddress + deceasedOwnerName) while heirName/relation/phone rotate per
// item.
export interface HeirQueueItem {
  prospect_phone_id: string
  phone: string
  heirName: string
  relation: string
  leadId: string
  propertyAddress: string
  deceasedOwnerName: string
}

export interface DialerSettings {
  callerId?: string | null
  agent?: string | null
  mode?: 'power' | 'predictive' | string | null
  pacing?: number | null
}

interface DialerPanelProps {
  open: boolean
  onClose: () => void
  onStatusChange?: (status: CallStatus) => void
  pendingDial?: { phone: string; name: string; leadId: string } | null
  pendingQueue?: HeirQueueItem[] | null
  pendingSettings?: DialerSettings | null
}

function useCallTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    const resetId = requestAnimationFrame(() => setSeconds(0))
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => {
      cancelAnimationFrame(resetId)
      clearInterval(id)
    }
  }, [active])
  useEffect(() => {
    if (active) return
    const id = requestAnimationFrame(() => setSeconds(0))
    return () => cancelAnimationFrame(id)
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

function formatOutcome(value?: string | null) {
  if (!value) return 'Unknown'
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function callDirection(call: RecentCall) {
  const direction = call.direction || call.metadata?.direction || ''
  if (direction.includes('inbound')) {
    return { label: 'Inbound', icon: 'call_received', className: 'text-sky-300 bg-sky-500/10' }
  }
  if (direction.includes('outbound')) {
    return { label: 'Outbound', icon: 'call_made', className: 'text-emerald-300 bg-emerald-500/10' }
  }
  return { label: 'Call', icon: 'call', className: 'text-white/45 bg-white/5' }
}

function callOutcome(call: RecentCall) {
  const raw = (call.outcome || call.metadata?.outcome || call.metadata?.callStatus || call.metadata?.status || '').toLowerCase()
  if (raw.includes('missed') || raw.includes('no-answer') || raw.includes('no answer')) {
    return { label: formatOutcome(raw || 'missed'), icon: 'phone_missed', className: 'text-red-300 bg-red-500/10' }
  }
  if (raw.includes('busy')) {
    return { label: 'Busy', icon: 'phone_disabled', className: 'text-amber-300 bg-amber-500/10' }
  }
  if (raw.includes('voicemail')) {
    return { label: formatOutcome(raw), icon: 'voicemail', className: 'text-violet-300 bg-violet-500/10' }
  }
  if (raw.includes('non_seller') || raw.includes('non seller')) {
    return { label: 'Non Seller', icon: 'support_agent', className: 'text-cyan-300 bg-cyan-500/10' }
  }
  if (raw.includes('received') || raw.includes('routed')) {
    return { label: formatOutcome(raw), icon: 'radio_button_checked', className: 'text-sky-300 bg-sky-500/10' }
  }
  if (raw.includes('spam')) {
    return { label: 'Spam', icon: 'block', className: 'text-red-300 bg-red-500/10' }
  }
  if (raw.includes('completed') || raw.includes('connected')) {
    return { label: formatOutcome(raw), icon: 'check_circle', className: 'text-emerald-300 bg-emerald-500/10' }
  }
  if (raw.includes('initiated') || raw.includes('pending')) {
    return { label: formatOutcome(raw), icon: 'pending', className: 'text-white/45 bg-white/5' }
  }
  return { label: formatOutcome(raw), icon: 'help', className: 'text-white/35 bg-white/5' }
}

function callerIdLabel(phone: string | null) {
  if (!phone) return null
  const known = TWILIO_NUMBERS.find((n) => n.value === phone)
  if (!known) return formatPhone(phone)
  return known.label.split('—')[0].trim()
}

function displayCallName(call: RecentCall) {
  if (call.lead_name) return toProperCase(call.lead_name)
  const phone = call.phone || call.from || call.to
  return phone ? formatPhone(phone) : 'Unknown'
}

function displayAgentName(agent: string | null) {
  if (!agent || agent === 'System') return null
  return toProperCase(agent)
}

function agentNameForCallerId(phone: string | null) {
  if (phone === '+18166088588') return 'Ernest'
  if (phone === '+18167277667') return 'Casey'
  return null
}

function callerIdDisplayLabel(phone: string | null) {
  if (!phone) return 'Default'
  return TWILIO_NUMBERS.find((n) => n.value === phone)?.label || formatPhone(phone)
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

export function DialerPanel({ open, onClose, onStatusChange, pendingDial, pendingQueue, pendingSettings }: DialerPanelProps) {
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
  const [recentCallsError, setRecentCallsError] = useState<string | null>(null)
  const [recentCallsLimit, setRecentCallsLimit] = useState(5)
  const [recentCallsHasMore, setRecentCallsHasMore] = useState(false)
  const [recentCallsLoading, setRecentCallsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'dial' | 'recent'>('dial')

  // Caller ID display
  const [callerIdDisplay, setCallerIdDisplay] = useState<string>('')
  const [sessionAgent, setSessionAgent] = useState<string | null>(null)
  const [callMode, setCallMode] = useState<'power' | 'predictive'>('power')
  const [callPacing, setCallPacing] = useState(18)

  // Disposition
  const [showDisposition, setShowDisposition] = useState(false)
  const lastCallPhoneRef = useRef<string>('')

  // Heir queue mode — when active, the property stays pinned across calls and
  // each disposition advances to the next heir phone.
  const [queue, setQueue] = useState<HeirQueueItem[] | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)
  const queueItem = queue && queue[queueIndex] ? queue[queueIndex] : null
  const queueMode = queue !== null && queue.length > 0
  const activeQueueItemRef = useRef<HeirQueueItem | null>(null)

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

  // Broadcast queue state so the /dialer page (or any other surface) can
  // render its own "Now calling" indicator without importing the bar.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('heir-queue-state', {
      detail: {
        queueItem,
        queueIndex,
        queueLength: queue?.length ?? 0,
        status,
      },
    }))
  }, [queueItem, queueIndex, queue, status])

  // Handle pendingQueue from HeirsSection — open heir-dialer queue mode.
  useEffect(() => {
    if (open && pendingQueue && pendingQueue.length > 0) {
      setQueue(pendingQueue)
      setQueueIndex(0)
      const first = pendingQueue[0]
      setSelectedLead({
        id: first.leadId,
        full_name: first.heirName,
        phone: first.phone,
        property_address: first.propertyAddress,
        city: null,
        station: null,
        priority: null,
        updated_at: new Date().toISOString(),
      })
      setDialNumber(first.phone)
      setSearchQuery('')
      setSearchResults([])
    }
  }, [open, pendingQueue])

  useEffect(() => {
    if (!open || !pendingSettings) return
    if (pendingSettings.callerId) setCallerIdDisplay(pendingSettings.callerId)
    if (pendingSettings.agent) setSessionAgent(pendingSettings.agent)
    if (pendingSettings.mode === 'power' || pendingSettings.mode === 'predictive') {
      setCallMode(pendingSettings.mode)
    }
    if (typeof pendingSettings.pacing === 'number' && Number.isFinite(pendingSettings.pacing)) {
      setCallPacing(pendingSettings.pacing)
    }
  }, [open, pendingSettings])

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
      if (cid) setCallerIdDisplay((current) => current || cid)
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
            if (refreshData.callerId) setCallerIdDisplay((current) => current || refreshData.callerId)
            log('token refreshed')
          }
        } catch {
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
      setRecentCallsError(null)
      setRecentCallsLoading(true)
      try {
        const res = await fetch(`/api/call-log?limit=${recentCallsLimit}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Unable to load recent calls')
        setRecentCalls(data.calls || [])
        setRecentCallsHasMore(Boolean(data.hasMore))
      } catch (err) {
        setRecentCalls([])
        setRecentCallsHasMore(false)
        setRecentCallsError(err instanceof Error ? err.message : 'Unable to load recent calls')
      } finally {
        setRecentCallsLoading(false)
      }
    }
    loadRecent()
  }, [open, recentCallsLimit])

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
    // Snapshot the queue item at call start so the disposition (which fires
    // after disconnect, possibly after advance) logs against the right heir.
    activeQueueItemRef.current = queueItem
    const callAgent = sessionAgent || agentNameForCallerId(callerIdDisplay) || 'Ernest'
    log(`calling ${number}`)
    try {
      const call = await deviceRef.current.connect({
        params: {
          To: number,
          ...(callerIdDisplay && { CallerId: callerIdDisplay }),
          CallMode: callMode,
          Pace: String(callPacing),
        },
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

      const heirMeta = activeQueueItemRef.current
        ? {
            heir_name: activeQueueItemRef.current.heirName,
            heir_relation: activeQueueItemRef.current.relation,
            prospect_phone_id: activeQueueItemRef.current.prospect_phone_id,
          }
        : null
      fetch('/api/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: number,
          event: 'started',
          agent: callAgent,
          from: callerIdDisplay || null,
          call_mode: callMode,
          pace: callPacing,
          lead_id: selectedLead?.id || null,
          ...heirMeta,
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
            agent: callAgent,
            from: callerIdDisplay || null,
            call_mode: callMode,
            pace: callPacing,
            lead_id: selectedLead?.id || null,
            ...heirMeta,
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
    const activeItem = activeQueueItemRef.current
    try {
      if (activeItem) {
        // Heir-dialer path: log to prospect_phones + activity feed via our own
        // endpoint (which handles both writes in one call).
        await fetch('/api/heirs/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prospect_phone_id: activeItem.prospect_phone_id,
            disposition,
            notes,
            lead_id: activeItem.leadId,
            agent: sessionAgent || agentNameForCallerId(callerIdDisplay) || 'Ernest',
          }),
        })
        window.dispatchEvent(new CustomEvent('heir-attempt-logged', {
          detail: { leadId: activeItem.leadId, prospectPhoneId: activeItem.prospect_phone_id },
        }))
      } else {
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
      }
      window.dispatchEvent(new CustomEvent('crm:disposition-logged', { detail: { leadId: selectedLead.id } }))
    } catch {}

    // Advance the heir queue after disposition is logged.
    if (queueMode) advanceQueue()
    activeQueueItemRef.current = null
  }

  function advanceQueue() {
    if (!queue) return
    const next = queueIndex + 1
    if (next >= queue.length) {
      // Queue complete — let listeners (e.g. /dialer page) advance to the
      // next lead before we reset local state.
      const finishedLeadId = queue[queueIndex]?.leadId
      if (finishedLeadId) {
        window.dispatchEvent(new CustomEvent('heir-queue-complete', {
          detail: { leadId: finishedLeadId },
        }))
      }
      setQueue(null)
      setQueueIndex(0)
      setSelectedLead(null)
      setDialNumber('')
      return
    }
    setQueueIndex(next)
    const item = queue[next]
    setSelectedLead({
      id: item.leadId,
      full_name: item.heirName,
      phone: item.phone,
      property_address: item.propertyAddress,
      city: null,
      station: null,
      priority: null,
      updated_at: new Date().toISOString(),
    })
    setDialNumber(item.phone)
  }

  function skipQueueItem() {
    advanceQueue()
  }

  function prevQueueItem() {
    if (!queue || queueIndex === 0) return
    const prev = queueIndex - 1
    setQueueIndex(prev)
    const item = queue[prev]
    setSelectedLead({
      id: item.leadId,
      full_name: item.heirName,
      phone: item.phone,
      property_address: item.propertyAddress,
      city: null,
      station: null,
      priority: null,
      updated_at: new Date().toISOString(),
    })
    setDialNumber(item.phone)
  }

  function endQueue() {
    setQueue(null)
    setQueueIndex(0)
    setSelectedLead(null)
    setDialNumber('')
  }

  function handleRedial(call: RecentCall) {
    if (call.phone) {
      setDialNumber(call.phone)
      setActiveTab('dial')
    }
  }

  function appendDialDigit(value: string) {
    setDialNumber((current) => `${current}${value}`)
  }

  function deleteDialDigit() {
    setDialNumber((current) => current.slice(0, -1))
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
  const displayDialNumber = dialNumber.trim() ? formatPhone(dialNumber) : '(816) 555-0000'
  const dialpadKeys = [
    { value: '1', letters: '' },
    { value: '2', letters: 'A B C' },
    { value: '3', letters: 'D E F' },
    { value: '4', letters: 'G H I' },
    { value: '5', letters: 'J K L' },
    { value: '6', letters: 'M N O' },
    { value: '7', letters: 'P Q R S' },
    { value: '8', letters: 'T U V' },
    { value: '9', letters: 'W X Y Z' },
    { value: '*', letters: '' },
    { value: '0', letters: '+' },
    { value: '#', letters: '' },
  ]

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed left-1/2 top-1/2 z-[70] flex max-h-[calc(100vh-1rem)] w-[520px] max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[28px] border border-white/15 bg-[#1b1b1e] shadow-[0_24px_70px_rgba(0,0,0,0.55)] transition-all duration-200 ease-out ${
          open ? '-translate-y-1/2 scale-100 opacity-100' : '-translate-y-[46%] scale-95 opacity-0 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="relative flex flex-col items-center gap-2 px-6 pb-4 pt-5">
          <div className="flex flex-col items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight text-white">Dialer</h2>
            <button
              onClick={() => { deviceInitialized.current = false; initDevice() }}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1 transition-colors hover:bg-white/15"
              title="Click to reconnect"
            >
              <div className={`w-2 h-2 rounded-full ${statusDotColor[status]} ${status === 'connecting' ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-bold text-white/55">{statusLabel[status]}</span>
            </button>
          </div>
          <button
            onClick={onClose}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/45 transition-colors hover:bg-white/15 hover:text-white"
          >
            <Icon name="close" size="text-3xl" />
          </button>
        </div>

        {/* Pinned property header — visible across the whole queue */}
        {queueMode && queueItem && (
          <div
            className="px-5 py-3 bg-[#1c1c1c] border-b-2 border-[#E32E2E]"
            style={{ borderLeft: '3px solid #E32E2E' }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#E32E2E] mb-0.5">
                  Heir queue · {queueIndex + 1} of {queue!.length}
                </p>
                <p className="text-sm font-bold text-white truncate">
                  {queueItem.deceasedOwnerName} <span className="text-white/40 font-normal">(deceased)</span>
                </p>
                {queueItem.propertyAddress && (
                  <p className="text-[11px] text-white/50 truncate">{queueItem.propertyAddress}</p>
                )}
              </div>
              <button
                onClick={endQueue}
                className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-md px-2 py-1 transition-colors"
                title="End heir queue — back to normal dialer"
              >
                End
              </button>
            </div>
            <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white truncate">
                  {queueItem.heirName}
                  <span className="text-white/40 font-normal capitalize"> · {queueItem.relation}</span>
                </p>
                <p className="text-[10px] font-mono text-white/50">{formatPhone(queueItem.phone)}</p>
              </div>
              <button
                onClick={prevQueueItem}
                disabled={queueIndex === 0 || isOnCall}
                className="flex-shrink-0 w-7 h-7 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/70 flex items-center justify-center transition-colors"
                title="Previous heir"
              >
                <Icon name="skip_previous" size="text-sm" />
              </button>
              <button
                onClick={skipQueueItem}
                disabled={isOnCall}
                className="flex-shrink-0 w-7 h-7 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/70 flex items-center justify-center transition-colors"
                title="Skip without logging"
              >
                <Icon name="skip_next" size="text-sm" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 pb-5 pt-1 space-y-4">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-[#E32E2E]/70 bg-[#E32E2E]/15 px-4 py-3">
              <Icon name="error" className="text-[#ff7777]" size="text-2xl" />
              <span className="flex-1 text-sm text-[#ffb4b4]">{error}</span>
              <button onClick={() => { setError(null); initDevice() }} className="text-sm font-black uppercase text-[#ffb4b4] hover:text-white">
                Retry
              </button>
            </div>
          )}

          {!isOnCall && status !== 'incoming' && (
            <div className="grid rounded-xl bg-[#303035] p-1">
              <div className="grid grid-cols-2">
                {(['dial', 'recent'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`h-11 rounded-lg text-lg font-black transition-colors ${
                      activeTab === tab
                        ? 'bg-[#6d6d72] text-white shadow-sm'
                        : 'text-white/45 hover:text-white/70'
                    }`}
                  >
                    {tab === 'dial' ? 'Dial' : 'Recent'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          {!isOnCall && status !== 'incoming' && activeTab === 'dial' && (
            <div className="relative">
              <div className="relative">
                <span className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                  {searching ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                  ) : (
                    <Icon name="search" className="text-white/40" size="text-2xl" />
                  )}
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search leads by name, phone, address..."
                  className="h-12 w-full rounded-xl border border-white/10 bg-[#141416] pl-12 pr-4 text-base text-white placeholder:text-white/35 focus:border-[#E32E2E]/50 focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/20"
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
          {selectedLead && !isOnCall && status !== 'incoming' && activeTab === 'dial' && (
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
          {!isOnCall && status !== 'incoming' && activeTab === 'dial' && (
            <div className="space-y-4">
              <input
                type="tel"
                value={dialNumber}
                onChange={(e) => setDialNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && makeCall()}
                placeholder="+1 (816) 555-0000"
                className="sr-only"
                aria-label="Phone number"
              />
              <div className="px-2 text-center">
                <p className="font-mono text-[clamp(28px,8vw,36px)] font-light tracking-[0.04em] text-white">
                  {displayDialNumber}
                </p>
              </div>
              <div className="mx-auto grid max-w-[336px] grid-cols-3 gap-x-4 gap-y-3 sm:gap-x-8">
                {dialpadKeys.map((key) => (
                  <button
                    key={key.value}
                    type="button"
                    onClick={() => appendDialDigit(key.value)}
                    className="flex h-[clamp(64px,22vw,80px)] w-[clamp(64px,22vw,80px)] flex-col items-center justify-center rounded-full bg-[#323238] text-white transition-colors hover:bg-[#3d3d43] active:bg-[#4a4a50]"
                    aria-label={`Dial ${key.value}`}
                  >
                    <span className="text-4xl font-light leading-none">{key.value}</span>
                    {key.letters && (
                      <span className="mt-1 text-[11px] font-black tracking-[0.22em] text-white/55">{key.letters}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 border-t border-white/15 pt-4 md:grid-cols-[minmax(0,1fr)_170px]">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-white/55">Calling From</span>
                  <select
                    value={callerIdDisplay}
                    onChange={(event) => setCallerIdDisplay(event.target.value)}
                    disabled={isOnCall}
                    className="h-11 w-full rounded-xl border border-white/10 bg-[#141416] px-3 py-2 text-sm font-bold text-white/80 outline-none transition-colors focus:border-[#E32E2E]/60 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Calling from"
                  >
                    <option value="">Default caller ID</option>
                    {callerIdDisplay && !TWILIO_NUMBERS.some((number) => number.value === callerIdDisplay) && (
                      <option value={callerIdDisplay}>{callerIdDisplayLabel(callerIdDisplay)}</option>
                    )}
                    {TWILIO_NUMBERS.map((number) => (
                      <option key={number.value} value={number.value}>{number.label}</option>
                    ))}
                  </select>
                </label>

                <div>
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-white/55">Call Hammer</span>
                  <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-[#141416] p-1">
                    {(['power', 'predictive'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCallMode(mode)}
                        className={`rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-wider transition-colors ${
                          callMode === mode ? 'bg-[#8B2228] text-white' : 'text-white/45 hover:text-white/75'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <label className="mt-3 block">
                    <span className="mb-2 block text-[11px] font-black uppercase tracking-widest text-white/45">Pace: {callPacing}s</span>
                    <input
                      type="range"
                      min={callMode === 'predictive' ? 6 : 12}
                      max="90"
                      value={callPacing}
                      onChange={(event) => setCallPacing(Number(event.target.value))}
                      className="w-full accent-[#E32E2E]"
                      aria-label="Call pace"
                    />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center pt-1">
                <span />
                <button
                  onClick={makeCall}
                  disabled={!dialNumber.trim() || status === 'connecting'}
                  className="flex h-[clamp(68px,22vw,80px)] w-[clamp(68px,22vw,80px)] items-center justify-center rounded-full bg-[#8B2228] text-white shadow-[0_14px_35px_rgba(139,34,40,0.3)] transition-colors hover:bg-[#A72A31] disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={status === 'offline' ? 'Call using phone' : 'Call'}
                >
                  <Icon name="call" size="text-3xl" />
                </button>
                <button
                  type="button"
                  onClick={deleteDialDigit}
                  disabled={!dialNumber}
                  className="ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Delete digit"
                >
                  <Icon name="backspace" size="text-2xl" />
                </button>
              </div>
            </div>
          )}

          {/* Recent Calls (when idle) */}
          {!isOnCall && status !== 'incoming' && activeTab === 'recent' && recentCalls.length > 0 && (
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-black text-white/35 uppercase tracking-widest">Recent Calls</h3>
                <span className="text-[10px] text-white/25">
                  {recentCalls.length}{recentCallsHasMore ? '+' : ''}
                </span>
              </div>
              <div className="space-y-1 max-h-[360px] overflow-y-auto pr-1">
                {recentCalls.map((call) => {
                  const direction = callDirection(call)
                  const outcome = callOutcome(call)
                  const duration = call.duration || call.metadata?.duration || null
                  const displayPhone = call.phone || call.to || call.from
                  const displayName = displayCallName(call)
                  const agentName = displayAgentName(call.agent)
                  const fromLabel = call.from ? callerIdLabel(call.from) : null
                  return (
                    <button
                      key={call.id}
                      onClick={() => handleRedial(call)}
                      className="w-full rounded-lg px-2.5 py-2 hover:bg-white/5 transition-colors text-left"
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${direction.className}`}
                          title={direction.label}
                        >
                          <Icon name={direction.icon} size="text-sm" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-white/85 font-semibold truncate">
                              {displayName}
                            </p>
                            <span className="text-[10px] text-white/30 flex-shrink-0">{formatTimeAgo(call.created_at)}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 min-w-0 text-[10px] text-white/35">
                            {call.direction?.includes('outbound') && agentName && (
                              <span className="truncate">{agentName}</span>
                            )}
                            {call.from && (
                              <span className="truncate">From {fromLabel}</span>
                            )}
                            {call.from && call.to && <span className="text-white/15">→</span>}
                            {call.to && (
                              <span className="truncate">To {formatPhone(call.to)}</span>
                            )}
                            {!call.from && !call.to && displayPhone && (
                              <span className="truncate">{formatPhone(displayPhone)}</span>
                            )}
                          </div>
                        </div>
                        <div
                          className={`flex items-center gap-1 rounded-md px-1.5 py-1 flex-shrink-0 ${outcome.className}`}
                          title={outcome.label}
                        >
                          <Icon name={outcome.icon} size="text-xs" />
                          {duration !== null && (
                            <span className="text-[10px] font-bold">{formatDuration(duration)}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
              {recentCallsHasMore && (
                <button
                  type="button"
                  onClick={() => setRecentCallsLimit((limit) => Math.min(limit + 10, 100))}
                  disabled={recentCallsLoading || recentCallsLimit >= 100}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-white/55 hover:bg-white/10 hover:text-white/75 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {recentCallsLoading ? 'Loading...' : 'Load More Calls'}
                </button>
              )}
            </section>
          )}

          {!isOnCall && status !== 'incoming' && activeTab === 'recent' && recentCalls.length === 0 && (
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <h3 className="text-[10px] font-black text-white/35 uppercase tracking-widest mb-1">Recent Calls</h3>
              <p className="text-xs text-white/45">
                {recentCallsError || 'No recent call activity found.'}
              </p>
            </section>
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
