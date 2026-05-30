'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { DispositionModal, DispositionType } from './disposition-modal'
import { NewTaskModal } from '@/components/modals/new-task-modal'
import { DialerCallerPlan, normalizeDialerCallerPlan } from '@/lib/dialer-caller-plan'

export type CallStatus = 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TwilioDevice = any
type TwilioErrorLike = {
  code?: number
  message?: string
  explanation?: string
  name?: string
  causes?: unknown[]
  originalError?: unknown
}

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
  agent?: string | null
  created_at: string
  metadata: {
    duration?: number
    direction?: string
    disposition?: string
    outcome?: string
    status?: string
    from?: string
    to?: string
    callStatus?: string
    dialStatus?: string
  } | null
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

interface DialerPanelProps {
  open: boolean
  onClose: () => void
  onStatusChange?: (status: CallStatus) => void
  pendingDial?: { phone: string; name: string; leadId: string; callerId?: string | null } | null
  pendingQueue?: HeirQueueItem[] | null
  pendingQueueCallerId?: string | null
  pendingQueueCallerPlan?: DialerCallerPlan | null
  pendingQueueAutoDial?: boolean
  presentation?: 'modal' | 'dock'
}

function resolveCallerIdForAttempt(
  plan: DialerCallerPlan,
  fallbackCallerId: string,
  attemptsPlaced: number,
): string {
  if (plan.mode !== 'rotation' || plan.rotationCallerIds.length === 0) {
    return plan.staticCallerId || fallbackCallerId
  }
  const safeEvery = Math.max(1, Math.floor(plan.rotateEveryCalls || 1))
  const index = Math.floor(Math.max(0, attemptsPlaced) / safeEvery) % plan.rotationCallerIds.length
  return plan.rotationCallerIds[index] || plan.staticCallerId || fallbackCallerId
}

function useCallTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const reset = window.setTimeout(() => setSeconds(0), 0)
    if (!active) return () => window.clearTimeout(reset)
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => {
      window.clearTimeout(reset)
      window.clearInterval(id)
    }
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

function extractTwilioErrorMessage(err: unknown): string {
  if (!err) return 'Dialer failed to initialize. Please retry.'
  if (err instanceof Error) return err.message || 'Dialer failed to initialize. Please retry.'
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const obj = err as TwilioErrorLike
    if (typeof obj.explanation === 'string' && obj.explanation.trim()) return obj.explanation.trim()
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim()
    if (typeof obj.name === 'string' && obj.name.trim()) return obj.name.trim()
  }
  return 'Dialer failed to initialize. Please retry.'
}

function isNonFatalAudioWarning(err: unknown): boolean {
  const msg = extractTwilioErrorMessage(err).toLowerCase()
  return (
    msg.includes('audio output') ||
    msg.includes('setsinkid') ||
    msg.includes('audio device') ||
    msg.includes('devices not found')
  )
}

function normalizeDispositionLabel(disposition: string) {
  return disposition.replace(/_/g, ' ')
}

function classifyDirection(metadata: RecentCall['metadata']): 'inbound' | 'outbound' | 'unknown' {
  if (metadata?.direction === 'inbound') return 'inbound'
  if (metadata?.direction === 'outbound') return 'outbound'
  return 'unknown'
}

function isNoAnswer(metadata: RecentCall['metadata']): boolean {
  if (!metadata) return false
  if (metadata.disposition === 'no_answer') return true
  if (metadata.outcome === 'missed') return true
  if (metadata.callStatus === 'no-answer' || metadata.callStatus === 'busy') return true
  if (metadata.dialStatus === 'no-answer' || metadata.dialStatus === 'busy') return true
  return false
}

function formatCallLeg(call: RecentCall): string {
  const metadata = call.metadata
  const direction = classifyDirection(metadata)
  const from = metadata?.from || null
  const to = metadata?.to || call.phone || null

  if (direction === 'outbound' && to) return `To ${formatPhone(to)}`
  if (direction === 'inbound' && from && to) return `From ${formatPhone(from)} → To ${formatPhone(to)}`
  if (direction === 'inbound' && from) return `From ${formatPhone(from)}`
  if (to) return formatPhone(to)
  return 'Unknown number'
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

const AGENT_NAME_BY_CALLER_ID: Record<string, string> = {
  '+18166088588': 'Ernest',
  '+18167277667': 'Casey',
}

const DIALER_KEYPAD: Array<{ value: string; letters?: string }> = [
  { value: '1' },
  { value: '2', letters: 'ABC' },
  { value: '3', letters: 'DEF' },
  { value: '4', letters: 'GHI' },
  { value: '5', letters: 'JKL' },
  { value: '6', letters: 'MNO' },
  { value: '7', letters: 'PQRS' },
  { value: '8', letters: 'TUV' },
  { value: '9', letters: 'WXYZ' },
  { value: '*' },
  { value: '0', letters: '+' },
  { value: '#' },
]

function stripDialFormatting(input: string): string {
  return input.replace(/[()\s-]/g, '')
}

function formatDialDisplay(input: string): string {
  const raw = stripDialFormatting(input).trim()
  if (!raw) return ''
  if (raw.includes('*') || raw.includes('#')) return raw
  if (/^\+?\d+$/.test(raw)) return formatPhone(raw)
  return raw
}

export function DialerPanel({
  open,
  onClose,
  onStatusChange,
  pendingDial,
  pendingQueue,
  pendingQueueCallerId,
  pendingQueueCallerPlan,
  pendingQueueAutoDial = false,
  presentation = 'dock',
}: DialerPanelProps) {
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
  const dialInputRef = useRef<HTMLInputElement>(null)

  // Recent calls
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([])
  const [viewTab, setViewTab] = useState<'dial' | 'recent'>('dial')

  // Caller ID display
  const [callerIdDisplay, setCallerIdDisplay] = useState<string>('')
  const [selectedCallerId, setSelectedCallerId] = useState<string>('')
  const [callerIdLockedByUser, setCallerIdLockedByUser] = useState(false)
  const [agentIdentity, setAgentIdentity] = useState<string>('crm-user')
  const [callerPlan, setCallerPlan] = useState<DialerCallerPlan>(() => normalizeDialerCallerPlan(null, ''))
  const [attemptsPlaced, setAttemptsPlaced] = useState(0)

  // Disposition
  const [showDisposition, setShowDisposition] = useState(false)
  const [showNewTaskFor, setShowNewTaskFor] = useState<SearchResult | null>(null)
  const lastCallPhoneRef = useRef<string>('')
  const [lastCallDuration, setLastCallDuration] = useState<string | null>(null)
  const lastCallDurationSecondsRef = useRef(0)
  const activeCallerId = selectedCallerId || callerIdDisplay
  const activeAgentName =
    agentIdentity === 'ernest'
      ? 'Ernest'
      : agentIdentity === 'casey'
      ? 'Casey'
      : AGENT_NAME_BY_CALLER_ID[activeCallerId] || 'System'
  const callerIdOptions = useMemo(() => {
    const options: Array<{ label: string; value: string }> = TWILIO_NUMBERS.map((num) => ({ label: num.label, value: num.value }))
    if (callerIdDisplay && !options.some((opt) => opt.value === callerIdDisplay)) {
      options.unshift({ label: `${formatPhone(callerIdDisplay)} — Default`, value: callerIdDisplay })
    }
    return options
  }, [callerIdDisplay])
  const fallbackCallerId = selectedCallerId || callerIdDisplay || callerIdOptions[0]?.value || ''
  const rotatedCallerId = resolveCallerIdForAttempt(callerPlan, fallbackCallerId, attemptsPlaced)

  // Heir queue mode — when active, the property stays pinned across calls and
  // each disposition advances to the next heir phone.
  const [queue, setQueue] = useState<HeirQueueItem[] | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)
  const queueItem = queue && queue[queueIndex] ? queue[queueIndex] : null
  const queueMode = queue !== null && queue.length > 0
  const activeQueueItemRef = useRef<HeirQueueItem | null>(null)
  const pendingAutoDialRef = useRef(false)
  const makeCallRef = useRef<() => Promise<void> | void>(() => {})

  // Handle pendingDial from ARI page click-to-call
  useEffect(() => {
    if (open && pendingDial?.phone) {
      setViewTab('dial')
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
      if (pendingDial.callerId) {
        setSelectedCallerId(pendingDial.callerId)
        setCallerIdLockedByUser(false)
        setCallerPlan(normalizeDialerCallerPlan({
          mode: 'static',
          staticCallerId: pendingDial.callerId,
          rotationCallerIds: [],
          rotateEveryCalls: 1,
          redialCallerId: null,
        }, pendingDial.callerId))
      }
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
        callDuration: status === 'on_call' ? callTimer : status === 'calling' ? '00:00' : null,
      },
    }))
  }, [callTimer, queueItem, queueIndex, queue, status])

  // Handle pendingQueue from HeirsSection — open heir-dialer queue mode.
  useEffect(() => {
    if (open && pendingQueue && pendingQueue.length > 0) {
      setViewTab('dial')
      setQueue(pendingQueue)
      setQueueIndex(0)
      const planFromEvent = normalizeDialerCallerPlan(
        pendingQueueCallerPlan,
        typeof pendingQueueCallerId === 'string' ? pendingQueueCallerId.trim() : '',
      )
      setCallerPlan(planFromEvent)
      setAttemptsPlaced(0)
      const initialCallerId = resolveCallerIdForAttempt(planFromEvent, planFromEvent.staticCallerId, 0)
      if (initialCallerId) {
        setSelectedCallerId(initialCallerId)
        setCallerIdLockedByUser(false)
      }
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
      if (pendingQueueAutoDial) pendingAutoDialRef.current = true
      setSearchQuery('')
      setSearchResults([])
    }
  }, [open, pendingQueue, pendingQueueCallerId, pendingQueueCallerPlan, pendingQueueAutoDial])

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
      const { token, callerId: cid, identity } = data
      if (cid) {
        setCallerIdDisplay(cid)
        setSelectedCallerId((prev) => {
          if (callerIdLockedByUser && prev) return prev
          return prev || cid
        })
      }
      if (identity) setAgentIdentity(identity)
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
            if (refreshData.callerId) {
              setCallerIdDisplay(refreshData.callerId)
              setSelectedCallerId((prev) => {
                if (callerIdLockedByUser && prev) return prev
                return prev || refreshData.callerId
              })
            }
            if (refreshData.identity) setAgentIdentity(refreshData.identity)
            log('token refreshed')
          }
        } catch {
          log('token refresh failed')
        }
      })
      device.on('error', (err: TwilioErrorLike) => {
        const msg = extractTwilioErrorMessage(err)
        if (isNonFatalAudioWarning(err)) {
          log(`non-fatal audio warning: ${msg}`)
          return
        }
        log(`device error: ${msg}`)
        setError(msg)
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
      const msg = extractTwilioErrorMessage(err)
      log(`init error: ${msg}`)
      setError(msg)
      setStatusLogged('offline')
    }
  }, [callerIdLockedByUser, setStatusLogged])

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
        const res = await fetch('/api/call-log?limit=50')
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

    if (!deviceRef.current || status !== 'ready') {
      setError(status === 'offline'
        ? 'Twilio is offline. Click Connect Twilio and wait for Ready before calling.'
        : 'Twilio is still connecting. Try again when the dialer shows Ready.'
      )
      if (status === 'offline') initDevice()
      return
    }

    setStatusLogged('calling')
    setError(null)
    setLastCallDuration(null)
    lastCallDurationSecondsRef.current = 0
    lastCallPhoneRef.current = number
    // Snapshot the queue item at call start so the disposition (which fires
    // after disconnect, possibly after advance) logs against the right heir.
    activeQueueItemRef.current = queueItem
    log(`calling ${number}`)
    try {
      const callerIdForThisCall = callerPlan.mode === 'rotation' && !callerIdLockedByUser
        ? rotatedCallerId
        : (effectiveCallerId || '')
      const params: Record<string, string> = { To: number }
      if (callerIdForThisCall) params.CallerId = callerIdForThisCall
      // enableRingingState: true is required by the Twilio Voice SDK so the
      // parent (browser) call emits a 'ringing' event and plays the network
      // ringback tone while the destination phone rings. Without it the
      // call transitions pending → connecting → open with no audible
      // feedback. This surfaced after PR #131 added answerOnBridge="true"
      // to the outbound TwiML — answerOnBridge holds the parent in
      // "ringing" until the destination answers, and the SDK has to be
      // told to honor that.
      const call = await deviceRef.current.connect({
        params,
        rtcConstraints: { audio: true },
        enableRingingState: true,
      })
      if (callerPlan.mode === 'rotation' && !callerIdLockedByUser) {
        setAttemptsPlaced((current) => current + 1)
      }
      callRef.current = call
      callStartRef.current = Date.now()
      let callWasAccepted = false

      call.on('ringing', () => {
        log('ringing...')
        setStatusLogged('calling')
      })
      call.on('accept', () => {
        callWasAccepted = true
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
          agent: activeAgentName,
          agent_identity: agentIdentity,
          from_number: callerIdForThisCall || null,
          lead_id: selectedLead?.id || null,
          ...heirMeta,
        }),
      }).catch(() => {})

      call.on('disconnect', () => {
        const duration = Math.round((Date.now() - callStartRef.current) / 1000)
        const finalStatus = callWasAccepted ? 'completed' : 'no-answer'
        const finalOutcome = callWasAccepted ? 'connected' : 'missed'
        const finalDisposition = callWasAccepted ? 'answered' : 'no_answer'
        lastCallDurationSecondsRef.current = duration
        setLastCallDuration(formatDuration(duration))
        fetch('/api/call-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: number,
            event: 'ended',
            duration,
            status: finalStatus,
            outcome: finalOutcome,
            disposition: finalDisposition,
            agent: activeAgentName,
            agent_identity: agentIdentity,
            from_number: callerIdForThisCall || null,
            lead_id: selectedLead?.id || null,
            ...heirMeta,
          }),
        }).catch(() => {})
        callRef.current = null
        setStatusLogged('ready')
        setMuted(false)
        // Always prompt for disposition after a call ends — the modal
        // handles the no-lead case (manual dial) gracefully.
        setShowDisposition(true)
      })
      call.on('cancel', () => {
        callRef.current = null
        setStatusLogged('ready')
        setMuted(false)
        setShowDisposition(true)
      })
    } catch (err) {
      const msg = extractTwilioErrorMessage(err)
      log(`makeCall error: ${msg}`)
      setError(msg)
      setStatusLogged('ready')
    }
  }

  makeCallRef.current = makeCall

  useEffect(() => {
    if (
      !pendingAutoDialRef.current ||
      showDisposition ||
      status !== 'ready' ||
      !queueMode ||
      !queueItem ||
      !dialNumber.trim()
    ) {
      return
    }

    const timeout = window.setTimeout(() => {
      if (
        !pendingAutoDialRef.current ||
        showDisposition ||
        status !== 'ready' ||
        !queueItem ||
        !dialNumber.trim()
      ) {
        return
      }
      pendingAutoDialRef.current = false
      void makeCallRef.current()
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [dialNumber, queueItem, queueMode, showDisposition, status])

  // Auto-focus the dial input when the dialer opens (idle / dial tab only),
  // so the user can immediately type a number on their keyboard without
  // clicking into the field. Skipped while on a call or in the recent tab.
  useEffect(() => {
    if (!open) return
    const isOnCallNow = status === 'on_call' || status === 'calling'
    if (isOnCallNow || status === 'incoming') return
    if (viewTab !== 'dial') return
    const id = window.setTimeout(() => {
      dialInputRef.current?.focus()
    }, 200)
    return () => window.clearTimeout(id)
  }, [open, status, viewTab])

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

  function appendDialChar(char: string) {
    setDialNumber((prev) => {
      const base = stripDialFormatting(prev)
      if (char === '+') return base.length === 0 ? '+' : base
      return `${base}${char}`
    })
  }

  function backspaceDial() {
    setDialNumber((prev) => stripDialFormatting(prev).slice(0, -1))
  }

  async function handleDisposition(
    disposition: DispositionType,
    notes?: string,
    options?: { markAsLead?: boolean; autoDialNext?: boolean },
  ) {
    if (!selectedLead) {
      // Manual dial without a lead — log to call_log so the disposition is
      // not lost. The handler returns true so the modal closes cleanly.
      await fetch('/api/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          outcome: disposition,
          disposition,
          to_number: lastCallPhoneRef.current,
          from_number: activeCallerId || null,
          agent: activeAgentName,
          duration_seconds: lastCallDurationSecondsRef.current || null,
          notes: notes || null,
        }),
      }).catch(() => {})
      return true
    }
    const activeItem = activeQueueItemRef.current
    try {
      if (activeItem) {
        // Heir-dialer path: log to prospect_phones + activity feed via our own
        // endpoint (which handles both writes in one call).
        const response = await fetch('/api/heirs/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prospect_phone_id: activeItem.prospect_phone_id,
            disposition,
            notes,
            lead_id: activeItem.leadId,
            agent: activeAgentName,
            duration: lastCallDurationSecondsRef.current || null,
            mark_as_lead: Boolean(options?.markAsLead),
          }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || 'Could not save heir disposition.')
        }
        window.dispatchEvent(new CustomEvent('heir-attempt-logged', {
          detail: { leadId: activeItem.leadId, prospectPhoneId: activeItem.prospect_phone_id },
        }))
      } else {
        const response = await fetch('/api/leads', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedLead.id,
            activity: {
              type: 'call',
              disposition,
              notes,
              phone: lastCallPhoneRef.current,
              agent: activeAgentName,
            },
          }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || 'Could not save call disposition.')
        }
      }
      window.dispatchEvent(new CustomEvent('crm:disposition-logged', { detail: { leadId: selectedLead.id } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save disposition.')
      return false
    }

    // Advance the heir queue after disposition is logged.
    const nextQueueItem = queueMode ? advanceQueue() : null
    if (nextQueueItem && options?.autoDialNext) {
      pendingAutoDialRef.current = true
    }
    activeQueueItemRef.current = null
    return true
  }

  function advanceQueue(): HeirQueueItem | null {
    if (!queue) return null
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
      return null
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
    return item
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
      setViewTab('dial')
      setDialNumber(call.phone)
    }
  }

  const statusDotColor: Record<CallStatus, string> = {
    offline: 'bg-slate-500',
    connecting: 'bg-[var(--skc-warning)]',
    ready: 'bg-[var(--skc-success)]',
    calling: 'bg-[#E32E2E]',
    on_call: 'bg-[#E32E2E]',
    incoming: 'bg-[#E32E2E]',
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
  const isDocked = presentation === 'dock'
  const effectiveCallerId = callerPlan.mode === 'rotation' && !callerIdLockedByUser
    ? rotatedCallerId
    : (activeCallerId || callerIdOptions[0]?.value || '')
  const dispositionQueueItem = activeQueueItemRef.current

  return (
    <>
      {/* Backdrop */}
      {open && !isDocked && (
        <div
          className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[6px] transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={
          isDocked
            ? `fixed right-3 bottom-3 sm:right-5 sm:bottom-5 z-[70] transition-opacity duration-300 ${
                open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`
            : `fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5 transition-opacity duration-300 ${
                open ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`
        }
      >
        <div
          className={`w-[388px] max-w-[calc(100vw-1rem)] ${
            isDocked
              ? 'h-[min(82vh,760px)]'
              : 'max-h-[calc(100dvh-2rem)] h-auto'
          } bg-[var(--skc-surface-1)] border border-[var(--skc-separator)] rounded-[var(--skc-radius-modal)] shadow-[0_24px_70px_rgba(0,0,0,0.62)] transform transition-all duration-300 ease-out flex flex-col ${
            open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
          } ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
        {/* Header */}
        <div className="grid grid-cols-[60px_1fr_60px] items-center px-4 pt-3.5 pb-2.5">
          <div />
          <div className="text-center">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--skc-text-primary)]">Dialer</h2>
            <button
              onClick={() => { deviceInitialized.current = false; initDevice() }}
              className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full border border-[var(--skc-separator)] bg-[var(--skc-surface-3)] hover:bg-[var(--skc-surface-2)] transition-colors"
              title="Click to reconnect"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${statusDotColor[status]} ${status === 'connecting' ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] font-medium text-[var(--skc-text-tertiary)] tracking-[-0.01em]">{statusLabel[status]}</span>
            </button>
          </div>
          <button
            onClick={onClose}
            className="justify-self-end w-[30px] h-[30px] rounded-full bg-[var(--skc-surface-3)] text-[var(--skc-text-tertiary)] hover:text-white hover:bg-[var(--skc-surface-2)] transition-colors flex items-center justify-center"
          >
            <Icon name="close" size="text-[16px]" />
          </button>
        </div>

        {/* Pinned property header — visible across the whole queue */}
        {queueMode && queueItem && (
          <div
            className="px-5 py-3 bg-[#17171D] border-b border-[#2B2B31]"
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
                className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-white border border-[#31313A] hover:border-white/40 rounded-[8px] px-2 py-1 transition-colors"
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
                className="flex-shrink-0 w-7 h-7 rounded-[8px] bg-[#1E1E25] hover:bg-[#26262F] border border-[#31313A] disabled:opacity-30 disabled:cursor-not-allowed text-white/70 flex items-center justify-center transition-colors"
                title="Previous heir"
              >
                <Icon name="skip_previous" size="text-sm" />
              </button>
              <button
                onClick={skipQueueItem}
                disabled={isOnCall}
                className="flex-shrink-0 w-7 h-7 rounded-[8px] bg-[#1E1E25] hover:bg-[#26262F] border border-[#31313A] disabled:opacity-30 disabled:cursor-not-allowed text-white/70 flex items-center justify-center transition-colors"
                title="Skip without logging"
              >
                <Icon name="skip_next" size="text-sm" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable body — min-h-0 is required so flex-1 actually shrinks
            below content size and the panel respects max-h cap. Without it
            the body forces the panel past the viewport. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[#E32E2E]/10 border border-[#7D2626]">
              <Icon name="error" className="text-red-400" size="text-sm" />
              <span className="text-xs text-red-300 flex-1">{error}</span>
              <button onClick={() => { setError(null); initDevice() }} className="text-[10px] font-bold text-red-300 hover:text-white uppercase">
                Retry
              </button>
            </div>
          )}

          {!isOnCall && status !== 'incoming' && (
            <div className="grid grid-cols-2 rounded-[var(--skc-radius-pill)] bg-[var(--skc-surface-3)] p-0.5 gap-0.5 mx-4 mb-1">
              <button
                onClick={() => setViewTab('dial')}
                className={`px-3 py-[7px] rounded-[var(--skc-radius-tile)] text-[13px] font-medium tracking-[-0.01em] transition-colors ${
                  viewTab === 'dial' ? 'bg-[#636366] text-white font-semibold' : 'text-[var(--skc-text-tertiary)] hover:text-white'
                }`}
              >
                Dial
              </button>
              <button
                onClick={() => setViewTab('recent')}
                className={`px-3 py-[7px] rounded-[var(--skc-radius-tile)] text-[13px] font-medium tracking-[-0.01em] transition-colors ${
                  viewTab === 'recent' ? 'bg-[#636366] text-white font-semibold' : 'text-[var(--skc-text-tertiary)] hover:text-white'
                }`}
              >
                Recent
              </button>
            </div>
          )}

          {/* Search */}
          {!isOnCall && status !== 'incoming' && viewTab === 'dial' && (
            <div className="relative mx-4">
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
                  className="w-full bg-[var(--skc-surface-3)] text-[var(--skc-text-primary)] placeholder-[var(--skc-text-tertiary)] rounded-[var(--skc-radius-control)] pl-10 pr-4 py-[9px] text-[15px] tracking-[-0.01em] border border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--skc-brand-soft-border)] focus:border-[var(--skc-brand-soft-border)] transition-all"
                />
              </div>

              {/* Search results dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute top-full left-4 right-4 mt-1 bg-[var(--skc-surface-2)] border border-[var(--skc-separator)] rounded-[var(--skc-radius-control)] shadow-2xl overflow-hidden z-10 max-h-[320px] overflow-y-auto">
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
          {selectedLead && !isOnCall && status !== 'incoming' && viewTab === 'dial' && (
            <div className="mx-4 bg-[var(--skc-surface-soft)] border border-[var(--skc-separator)] rounded-[var(--skc-radius-card)] p-3">
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
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF6D6D] hover:text-white mt-1.5 transition-colors"
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
            <div className="bg-[#1A1616] border border-[#7D2626] rounded-[6px] p-5 animate-pulse">
              <div className="text-center mb-4">
                <div className="w-14 h-14 bg-[#E32E2E]/20 rounded-[6px] flex items-center justify-center mx-auto mb-3">
                  <Icon name="call" className="text-[#FF7A7A]" size="text-2xl" />
                </div>
                <p className="text-white font-bold text-lg">Incoming Call</p>
                <p className="text-white/50 text-sm">Unknown Caller</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={acceptIncoming}
                  className="flex-1 py-3 bg-white text-black font-bold rounded-[6px] hover:bg-white/90 transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="call" size="text-lg" />
                  Accept
                </button>
                <button
                  onClick={rejectIncoming}
                  className="flex-1 py-3 bg-[#E32E2E] text-white font-bold rounded-[6px] hover:bg-[#C42626] transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="call_end" size="text-lg" />
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Active Call Card */}
          {isOnCall && (
            <div className={`rounded-[6px] p-5 border transition-all ${status === 'on_call' ? 'bg-[#191417] border-[#7D2626]' : 'bg-[#18181E] border-[#2F2F38]'}`}
              style={status === 'on_call' ? { animation: 'pulse-border 2s ease-in-out infinite' } : undefined}
            >
              <div className="text-center mb-4">
                <div className={`w-12 h-12 rounded-[6px] flex items-center justify-center mx-auto mb-2 ${status === 'on_call' ? 'bg-[#E32E2E]/20' : 'bg-white/10'}`}>
                  <Icon name="call" className={status === 'on_call' ? 'text-[#FF7A7A]' : 'text-white'} size="text-2xl" />
                </div>
                {selectedLead && (
                  <p className="text-white font-bold text-base">{selectedLead.full_name}</p>
                )}
                <p className="text-white/60 font-mono text-sm">{dialNumber}</p>
                {status === 'on_call' && (
                  <p className="text-[#FF7A7A] font-mono text-xl font-bold mt-1">{callTimer}</p>
                )}
                {status === 'calling' && (
                  <p className="text-white/80 text-sm mt-1 animate-pulse">Dialing...</p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={toggleMute}
                  className={`flex-1 py-2.5 rounded-[6px] font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                    muted ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-[#1E1E25] text-white/75 border border-[#31313A] hover:bg-[#272730]'
                  }`}
                >
                  <Icon name={muted ? 'mic_off' : 'mic'} size="text-lg" />
                  {muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={hangup}
                  className="flex-1 py-2.5 bg-[#E32E2E] text-white font-bold rounded-[6px] hover:bg-[#C42626] transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="call_end" size="text-lg" />
                  Hang Up
                </button>
              </div>
            </div>
          )}

          {/* Dial Section (when not on call and not incoming) */}
          {!isOnCall && status !== 'incoming' && viewTab === 'dial' && (
            <div>
              <div className="px-4 pb-2 text-center">
                <input
                  ref={dialInputRef}
                  type="tel"
                  inputMode="tel"
                  value={formatDialDisplay(dialNumber)}
                  onChange={(e) => setDialNumber(stripDialFormatting(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dialNumber.trim() && status === 'ready') {
                      e.preventDefault()
                      makeCall()
                    }
                  }}
                  placeholder=""
                  aria-label="Phone number"
                  className="w-full bg-transparent border-0 text-center text-[28px] font-light tracking-[-0.02em] text-[var(--skc-text-primary)] [font-feature-settings:'tnum'] focus:outline-none"
                />
              </div>

              <div className="px-8 pb-3 grid grid-cols-3 gap-x-4 gap-y-2 justify-items-center">
                {DIALER_KEYPAD.map((key) => (
                  <button
                    key={key.value}
                    onClick={() => appendDialChar(key.value)}
                    className="w-14 h-14 rounded-full bg-[var(--skc-surface-3)] hover:bg-[var(--skc-surface-2)] transition-colors flex flex-col items-center justify-center"
                    aria-label={`Dial ${key.value}`}
                  >
                    <span className="text-[24px] font-light leading-none tracking-[-0.02em] text-[var(--skc-text-primary)]">
                      {key.value}
                    </span>
                    <span className="text-[8px] font-semibold tracking-[0.18em] text-[var(--skc-text-tertiary)] mt-0.5 min-h-[10px]">
                      {key.letters || '\u00A0'}
                    </span>
                  </button>
                ))}
              </div>

              <div className="px-4 pb-2 grid grid-cols-[56px_1fr_56px] items-center gap-3">
                <div />
                <button
                  onClick={makeCall}
                  disabled={!dialNumber.trim() || status !== 'ready'}
                  className="w-14 h-14 rounded-full bg-[#30D158] hover:bg-[#28B14B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center justify-self-center shadow-lg shadow-[#30D158]/30"
                  title={status === 'ready' ? 'Call' : 'Waiting for Twilio'}
                  aria-label={status === 'ready' ? 'Call' : 'Waiting for Twilio'}
                >
                  <Icon name="call" size="text-[24px]" className="text-white" filled />
                </button>
                <button
                  onClick={backspaceDial}
                  disabled={!dialNumber}
                  className="w-10 h-10 rounded-full bg-[var(--skc-surface-3)] hover:bg-[var(--skc-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center justify-self-center"
                  aria-label="Backspace"
                >
                  <Icon name="keyboard_backspace" size="text-[18px]" className="text-[var(--skc-text-secondary)]" />
                </button>
              </div>

              <div className="border-t border-[var(--skc-separator)] px-4 py-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-tertiary)] mb-0.5">
                  Calling from
                </div>
                {callerIdOptions.length > 0 ? (
                  <div className="relative">
                    <select
                      value={effectiveCallerId}
                      onChange={(e) => {
                        const value = e.target.value
                        setSelectedCallerId(value)
                        setCallerIdLockedByUser(true)
                        setCallerPlan((current) => normalizeDialerCallerPlan({
                          ...current,
                          mode: 'static',
                          staticCallerId: value,
                        }, value))
                      }}
                      className="w-full bg-[var(--skc-surface-3)] text-[var(--skc-text-primary)] rounded-[var(--skc-radius-control)] px-3 pr-8 py-1.5 text-[14px] font-medium tracking-[-0.01em] border border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--skc-brand-soft-border)] appearance-none"
                    >
                      {callerIdOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-[var(--skc-surface-2)]">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--skc-text-quaternary)]">
                      <Icon name="chevron_right" size="text-[15px]" />
                    </span>
                  </div>
                ) : (
                  <div className="text-[15px] font-medium tracking-[-0.01em] text-[var(--skc-text-primary)]">
                    {effectiveCallerId ? formatPhone(effectiveCallerId) : 'No caller ID available'}
                  </div>
                )}
                {callerPlan.mode === 'rotation' && callerPlan.rotationCallerIds.length > 1 && (
                  <p className="mt-1.5 text-[10px] tracking-[-0.01em] text-[var(--skc-text-tertiary)]">
                    Rotation active · every {callerPlan.rotateEveryCalls} calls · {callerPlan.rotationCallerIds.length} numbers
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Recent Calls (when idle) */}
          {!isOnCall && status !== 'incoming' && viewTab === 'recent' && recentCalls.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest">Recent Calls</h3>
                <span className="text-[10px] text-white/30 tabular-nums">{recentCalls.length}</span>
              </div>
              <div className="space-y-1.5 max-h-[min(26rem,50vh)] overflow-y-auto pr-1">
                {recentCalls.map((call) => {
                  const direction = classifyDirection(call.metadata)
                  const noAnswer = isNoAnswer(call.metadata)
                  const missedCall = call.metadata?.outcome === 'missed' || call.metadata?.callStatus === 'no-answer' || call.metadata?.dialStatus === 'no-answer'
                  const disposition = call.metadata?.disposition || null
                  const status = call.metadata?.status || null
                  const duration = typeof call.metadata?.duration === 'number' ? call.metadata.duration : 0
                  const isCompleted = status === 'completed' || duration > 0 || disposition === 'answered' || call.metadata?.outcome === 'connected'
                  const isPending = status === 'initiated' || status === 'ringing' || status === 'queued'
                  const isVoicemail = disposition === 'voicemail_left' || disposition === 'left_voicemail'
                  const leftIcon =
                    direction === 'outbound'
                      ? 'call_made'
                      : direction === 'inbound'
                      ? 'call_received'
                      : 'call'
                  const leftTone =
                    direction === 'outbound'
                      ? 'bg-[#30D15826] text-[#30D158]'
                      : direction === 'inbound'
                      ? 'bg-[#64D2FF26] text-[#64D2FF]'
                      : 'bg-[#BF5AF226] text-[#BF5AF2]'
                  const detailParts = [formatCallLeg(call)]
                  if (call.agent) detailParts.push(call.agent)
                  if (disposition) detailParts.push(normalizeDispositionLabel(disposition))
                  const detailLine = detailParts.join(' · ')

                  return (
                    <button
                      key={call.id}
                      onClick={() => handleRedial(call)}
                      className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-[6px] border border-[#2F2F38] bg-[#17171D] hover:bg-[#1D1D25] transition-colors text-left"
                    >
                      <div className={`w-10 h-10 rounded-[6px] flex items-center justify-center flex-shrink-0 ${leftTone}`}>
                        <Icon name={leftIcon} size="text-xl" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <p className="text-sm text-white/90 font-semibold truncate">
                            {call.lead_name || call.phone || 'Unknown'}
                          </p>
                          <span className="text-xs text-white/35 flex-shrink-0">{formatTimeAgo(call.created_at)}</span>
                        </div>
                        <p className="text-xs text-white/45 truncate">{detailLine}</p>
                      </div>

                      {noAnswer ? (
                        <span
                          className={`flex-shrink-0 w-11 h-11 rounded-[6px] flex items-center justify-center ${
                            missedCall
                              ? 'bg-[#FF453A1A] border border-[#FF453A66]'
                              : 'bg-[#1F2026] border border-[#363842]'
                          }`}
                        >
                          <Icon name={missedCall ? 'missed_call_badge' : 'no_answer_badge'} size="text-xl" />
                        </span>
                      ) : isVoicemail ? (
                        <span className="flex-shrink-0 w-11 h-11 rounded-[6px] bg-[#BF5AF226] text-[#BF5AF2] border border-[#BF5AF259] flex items-center justify-center">
                          <Icon name="support_agent" size="text-xl" />
                        </span>
                      ) : isCompleted ? (
                        <span className="flex-shrink-0 rounded-[6px] bg-[#30D1581F] border border-[#30D15873] px-2 py-1.5 text-[#30D158] inline-flex items-center gap-1.5 min-w-[62px] justify-center">
                          <Icon name="check_circle" size="text-base" />
                          <span className="text-xs font-bold tabular-nums">{duration > 0 ? formatDuration(duration) : 'done'}</span>
                        </span>
                      ) : isPending ? (
                        <span className="flex-shrink-0 w-11 h-11 rounded-[6px] bg-[#FF9F0A1F] text-[#FF9F0A] border border-[#FF9F0A59] flex items-center justify-center">
                          <Icon name="more_horiz" size="text-xl" />
                        </span>
                      ) : (
                        <span className="flex-shrink-0 w-11 h-11 rounded-[6px] bg-[#22222A] text-white/55 border border-[#31313A] flex items-center justify-center">
                          <Icon name="help" size="text-xl" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {!isOnCall && status !== 'incoming' && viewTab === 'recent' && recentCalls.length === 0 && (
            <div className="rounded-[6px] border border-[#2F2F38] bg-[#17171D] px-4 py-5 text-center">
              <p className="text-sm font-semibold text-white/80">No recent calls yet</p>
              <p className="text-xs text-white/40 mt-1">Calls will appear here after your first dial.</p>
            </div>
          )}

          {/* Reconnect button when offline */}
          {status === 'offline' && !error && viewTab === 'dial' && (
            <button
              onClick={initDevice}
              className="w-full py-2.5 bg-[#17171D] text-white/70 font-bold rounded-[6px] hover:bg-[#1E1E26] transition-colors flex items-center justify-center gap-2 text-xs border border-[#2F2F38]"
            >
              <Icon name="refresh" size="text-sm" />
              Connect Twilio
            </button>
          )}
        </div>
        </div>
      </div>

      {/* Pulsing border animation */}
      <style jsx>{`
        @keyframes pulse-border {
          0%, 100% { border-color: rgba(227, 46, 46, 0.35); }
          50% { border-color: rgba(227, 46, 46, 0.7); }
        }
      `}</style>

      {/* Disposition Modal */}
      <DispositionModal
        open={showDisposition}
        onClose={() => setShowDisposition(false)}
        onDisposition={handleDisposition}
        phoneNumber={lastCallPhoneRef.current}
        leadName={selectedLead?.full_name}
        callDuration={lastCallDuration || undefined}
        markAsLeadAvailable={Boolean(dispositionQueueItem)}
        markAsLeadLabel={dispositionQueueItem ? `Mark ${dispositionQueueItem.heirName} as lead` : undefined}
        variant={dispositionQueueItem ? 'heirQueue' : 'standard'}
        primaryActionLabel={dispositionQueueItem ? 'Save & Next Number' : 'Save & Next Lead'}
        nextActions={selectedLead ? [
          { id: 'set_next_activity', label: 'Set Next Activity', icon: 'event_note' },
        ] : []}
        onNextActionPick={(actionId) => {
          if (actionId === 'set_next_activity') {
            setShowNewTaskFor(selectedLead || null)
          }
        }}
      />

      {/* New Task modal — triggered by Set Next Activity from disposition */}
      {showNewTaskFor && (
        <NewTaskModal
          leadId={showNewTaskFor.id}
          leadName={showNewTaskFor.full_name || undefined}
          onClose={() => setShowNewTaskFor(null)}
          onCreated={() => {
            setShowNewTaskFor(null)
            window.dispatchEvent(new CustomEvent('crm:task-created', {
              detail: { leadId: showNewTaskFor.id },
            }))
          }}
        />
      )}
    </>
  )
}

// Re-export for backwards compat if anything imported TelephonyBar
export { DialerPanel as TelephonyBar }
