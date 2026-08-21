'use client'
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { CommsTimeline, CommsSummaryBar } from '@/components/leads/comms-timeline'
import { buildCommsTimeline, summarizeComms } from '@/lib/comms-timeline'
import { calculateTemperature } from '@/lib/lead-temperature'
import { toProperCase, formatPhone } from '@/lib/format'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { CallerIdMode, DialerCallerPlan, normalizeDialerCallerPlan, parseCallerIdsCsv } from '@/lib/dialer-caller-plan'
import { DEAD_REASONS } from '@/lib/dialer-dispositions'
import { loadDialerActivities, loadDialerLeadContext, type DialerActivity as Activity, type DialerManifest as ManifestShape } from '@/lib/dialer-lead-activity'
import { DialerSessionCommand } from '@/components/dialer/dialer-session-command'
import {
  createDurableDialerSession,
  loadDialerSavedQueuesWithOpenSession,
  loadDurableDialerSession,
  transitionDurableDialerSession,
  type DurableDialerSession,
} from '@/lib/dialer-session-client'

const HeirsSection = dynamic(() => import('@/components/leads/heirs-section').then((module) => module.HeirsSection))
const SmsComposeModal = dynamic(() => import('@/components/leads/sms-compose-modal').then((module) => module.SmsComposeModal))
const SmsThreadPanel = dynamic(() => import('@/components/leads/sms-thread-panel').then((module) => module.SmsThreadPanel))
const BulkSmsModal = dynamic(() => import('@/components/leads/bulk-sms-modal').then((module) => module.BulkSmsModal))
const DialerAiAssist = dynamic(() => import('@/components/dialer/dialer-ai-assist').then((module) => module.DialerAiAssist))
interface LeadSummary {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  is_favorite: boolean | null
}

interface ProspectSummary {
  id: string
  owner_1: string | null
  cumulative_due: number | null
  earliest_delinquent_year: number | null
  delinquent_years_category: string | null
  total_market_value: number | null
  zestimate: number | null
  situs_street: string | null
  situs_city: string | null
  situs_state: string | null
  situs_zip: string | null
  mailing_street: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  county: string | null
}

interface RecentCall {
  id: string
  lead_id: string | null
  lead_name: string | null
  phone: string | null
  created_at: string
  agent: string | null
  metadata: Record<string, unknown> | null
}

interface QueueState {
  queueItem: {
    phone: string
    heirName: string
    relation: string
    prospect_phone_id: string
    leadId: string
  } | null
  queueIndex: number
  queueLength: number
  callDuration?: string | null
  status: 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'
}

interface DialerQueueLead {
  id: string
  full_name: string | null
  phone: string | null
  property_address: string | null
  city: string | null
  state: string | null
  source: string | null
  station: string | null
  priority: string | null
  seller_situation: string | null
  motivation_score: number | null
  appointment_date: string | null
  created_at: string
  updated_at: string | null
}

interface QueueFollowup {
  lead_id: string | null
  activity_type: string
  metadata: { due_date?: string; status?: string; task_type?: string; title?: string } | null
  created_at: string
}

interface QueueContactActivity {
  lead_id: string | null
  activity_type: string
  created_at: string
}

interface QueueProspect {
  lead_id: string | null
  is_deceased: boolean | null
  delinquent_years_category: string | null
}

type QueuePreset = 'scheduled_today' | 'followups_today' | 'stale_30' | 'warm_followups' | 'cold_prospecting' | 'tax_2yr' | 'deceased_3yr' | 'priority' | 'next_step' | 'custom'
type QueueSort = 'recommended' | 'due_first' | 'oldest_contact' | 'newest' | 'oldest' | 'motivation' | 'name'

interface SavedDialerQueue {
  id: string
  name: string
  agent: string
  preset: QueuePreset
  callerId: string
  callerMode?: CallerIdMode
  rotationCallerIds?: string[]
  rotateEveryCalls?: number
  redialCallerId?: string | null
  startBehavior?: 'resume' | 'top'
  optionalFilters?: OptionalDialingFilters
  useCallHammer?: boolean
  useVoicemailCallHammer?: boolean
  campaign: string
  statusFilter: string
  priorityFilter: string
  minMotivation: number
  search: string
  sortBy: QueueSort
  visibleLimit: number
  sessionLeadIds: string[]
  resumeIndex: number
  resumeLeadId: string | null
  resumeUpdatedAt: string | null
  sessionCompleted: boolean
  createdAt: string
  updatedAt: string
  durableSessionId?: string
}

interface OptionalDialingFilters {
  attemptsFrom: string
  attemptsTo: string
  notDialed: 'none' | 'never' | '7d' | '14d' | '30d'
  notContactedDays: 'none' | 'never' | '1' | '3' | '7' | '14' | '30'
  createDateFrom: string
  createDateTo: string
  statusChangeFrom: string
  statusChangeTo: string
  callOldestToNewest: boolean
}

const QUEUE_PRESETS: Array<{ id: QueuePreset; label: string; icon: string; description: string }> = [
  { id: 'scheduled_today', label: 'Calendar Scheduled Today', icon: 'today', description: 'Calendar tasks, callbacks, and appointments due today.' },
  { id: 'followups_today', label: 'Follow-ups Today', icon: 'event_upcoming', description: 'Callbacks and next-step work due now.' },
  { id: 'stale_30', label: 'Not Contacted in 30 Days', icon: 'history', description: 'Callable leads with no recent call, SMS, or voicemail activity.' },
  { id: 'warm_followups', label: 'Warm Follow-ups', icon: 'local_fire_department', description: 'Hot, high-priority opportunities and motivated sellers.' },
  { id: 'cold_prospecting', label: 'Cold Prospecting', icon: 'ac_unit', description: 'Fresh or untouched records for outbound sessions.' },
  { id: 'tax_2yr', label: '2-Year Tax Delinquent', icon: 'request_quote', description: 'Tax delinquent prospects marked around two years.' },
  { id: 'deceased_3yr', label: '3+ Year Deceased Tax', icon: 'account_balance', description: 'Deceased-owner tax leads for the heir dialer workflow.' },
  { id: 'priority', label: 'Priority Queue', icon: 'priority_high', description: 'High intent by priority or motivation score.' },
  { id: 'next_step', label: 'Next-Step Date', icon: 'date_range', description: 'Leads with an appointment or next action date.' },
  { id: 'custom', label: 'Custom Filters', icon: 'tune', description: 'Build a session from campaign, status, score, and search.' },
]

const QUEUE_SORTS: Array<{ id: QueueSort; label: string }> = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'due_first', label: 'Due first' },
  { id: 'oldest_contact', label: 'Longest since contact' },
  { id: 'newest', label: 'Newest updated' },
  { id: 'oldest', label: 'Oldest updated' },
  { id: 'motivation', label: 'Motivation high to low' },
  { id: 'name', label: 'Name A-Z' },
]

const DEFAULT_DIALER_CALLER_ID = TWILIO_NUMBERS[0]?.value ?? ''
const SAVED_LIST_META_STORAGE_KEY = 'savingkc.dialer.saved-list-meta.v1'
const DEFAULT_ROTATION_EVERY_CALLS = 50
const DEFAULT_OPTIONAL_FILTERS: OptionalDialingFilters = {
  attemptsFrom: '',
  attemptsTo: '',
  notDialed: 'none',
  notContactedDays: 'none',
  createDateFrom: '',
  createDateTo: '',
  statusChangeFrom: '',
  statusChangeTo: '',
  callOldestToNewest: false,
}

type SavedListLocalMeta = {
  callerId?: string
  callerMode?: CallerIdMode
  rotationCallerIds?: string[]
  rotateEveryCalls?: number
  redialCallerId?: string | null
  startBehavior?: 'resume' | 'top'
  optionalFilters?: OptionalDialingFilters
  useCallHammer?: boolean
  useVoicemailCallHammer?: boolean
  sessionLeadIds?: string[]
  resumeIndex?: number
  resumeLeadId?: string | null
  resumeUpdatedAt?: string | null
  sessionCompleted?: boolean
}

function normalizeLocalLeadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function readSavedListMeta(): Record<string, SavedListLocalMeta> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(SAVED_LIST_META_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, SavedListLocalMeta> | null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSavedListMeta(next: Record<string, SavedListLocalMeta>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SAVED_LIST_META_STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

function normalizeOptionalFilters(value: Partial<OptionalDialingFilters> | null | undefined): OptionalDialingFilters {
  return {
    attemptsFrom: typeof value?.attemptsFrom === 'string' ? value.attemptsFrom.trim() : '',
    attemptsTo: typeof value?.attemptsTo === 'string' ? value.attemptsTo.trim() : '',
    notDialed: value?.notDialed === 'never' || value?.notDialed === '7d' || value?.notDialed === '14d' || value?.notDialed === '30d'
      ? value.notDialed
      : 'none',
    notContactedDays: value?.notContactedDays === 'never' || value?.notContactedDays === '1' || value?.notContactedDays === '3' || value?.notContactedDays === '7' || value?.notContactedDays === '14' || value?.notContactedDays === '30'
      ? value.notContactedDays
      : 'none',
    createDateFrom: typeof value?.createDateFrom === 'string' ? value.createDateFrom : '',
    createDateTo: typeof value?.createDateTo === 'string' ? value.createDateTo : '',
    statusChangeFrom: typeof value?.statusChangeFrom === 'string' ? value.statusChangeFrom : '',
    statusChangeTo: typeof value?.statusChangeTo === 'string' ? value.statusChangeTo : '',
    callOldestToNewest: Boolean(value?.callOldestToNewest),
  }
}

function patchSavedListMeta(id: string, patch: SavedListLocalMeta) {
  const key = id.trim()
  if (!key) return
  const current = readSavedListMeta()
  const existing = current[key] || {}
  const normalizedPlan = normalizeDialerCallerPlan(
    {
      mode: patch.callerMode ?? existing.callerMode,
      staticCallerId: patch.callerId ?? existing.callerId,
      rotationCallerIds: patch.rotationCallerIds ?? existing.rotationCallerIds,
      rotateEveryCalls: patch.rotateEveryCalls ?? existing.rotateEveryCalls,
      redialCallerId: patch.redialCallerId ?? existing.redialCallerId,
    },
    patch.callerId || existing.callerId || DEFAULT_DIALER_CALLER_ID,
  )
  const merged: SavedListLocalMeta = {
    ...existing,
    ...patch,
    callerId: normalizedPlan.staticCallerId,
    callerMode: normalizedPlan.mode,
    rotationCallerIds: normalizedPlan.rotationCallerIds,
    rotateEveryCalls: normalizedPlan.rotateEveryCalls,
    redialCallerId: normalizedPlan.redialCallerId,
    startBehavior: patch.startBehavior ?? existing.startBehavior ?? 'resume',
    optionalFilters: normalizeOptionalFilters(patch.optionalFilters ?? existing.optionalFilters ?? DEFAULT_OPTIONAL_FILTERS),
    useCallHammer: patch.useCallHammer ?? existing.useCallHammer ?? true,
    useVoicemailCallHammer: patch.useVoicemailCallHammer ?? existing.useVoicemailCallHammer ?? false,
    sessionLeadIds: patch.sessionLeadIds ? normalizeLocalLeadIds(patch.sessionLeadIds) : existing.sessionLeadIds,
    resumeIndex: patch.resumeIndex !== undefined
      ? Math.max(0, Math.floor(patch.resumeIndex))
      : existing.resumeIndex,
    resumeLeadId: patch.resumeLeadId !== undefined ? patch.resumeLeadId : existing.resumeLeadId,
    resumeUpdatedAt: patch.resumeUpdatedAt !== undefined ? patch.resumeUpdatedAt : existing.resumeUpdatedAt,
    sessionCompleted: patch.sessionCompleted !== undefined ? patch.sessionCompleted : existing.sessionCompleted,
  }
  current[key] = merged
  writeSavedListMeta(current)
}

function mergeSavedQueueWithLocalMeta(queue: SavedDialerQueue): SavedDialerQueue {
  const local = readSavedListMeta()[queue.id]
  if (!local) return queue
  const serverHasSession = (queue.sessionLeadIds?.length ?? 0) > 0
  const normalizedPlan = normalizeDialerCallerPlan(
    {
      mode: local.callerMode ?? queue.callerMode,
      staticCallerId: local.callerId ?? queue.callerId,
      rotationCallerIds: local.rotationCallerIds ?? queue.rotationCallerIds,
      rotateEveryCalls: local.rotateEveryCalls ?? queue.rotateEveryCalls,
      redialCallerId: local.redialCallerId ?? queue.redialCallerId,
    },
    queue.callerId || DEFAULT_DIALER_CALLER_ID,
  )
  return {
    ...queue,
    callerId: normalizedPlan.staticCallerId,
    callerMode: normalizedPlan.mode,
    rotationCallerIds: normalizedPlan.rotationCallerIds,
    rotateEveryCalls: normalizedPlan.rotateEveryCalls,
    redialCallerId: normalizedPlan.redialCallerId,
    startBehavior: local.startBehavior ?? queue.startBehavior ?? 'resume',
    optionalFilters: normalizeOptionalFilters(local.optionalFilters ?? queue.optionalFilters ?? DEFAULT_OPTIONAL_FILTERS),
    useCallHammer: local.useCallHammer ?? queue.useCallHammer ?? true,
    useVoicemailCallHammer: local.useVoicemailCallHammer ?? queue.useVoicemailCallHammer ?? false,
    // Resume state: the SERVER is authoritative whenever it has a saved
    // session. Local meta is only a fallback for environments where the resume
    // columns hadn't persisted yet. Previously local always won, so a stale
    // local resumeIndex (often 0, written on the first render of a session)
    // clobbered the real server pointer — that's why "resume where I left off"
    // jumped back to the top.
    ...(serverHasSession
      ? {
          sessionLeadIds: queue.sessionLeadIds,
          resumeIndex: queue.resumeIndex,
          resumeLeadId: queue.resumeLeadId,
          resumeUpdatedAt: queue.resumeUpdatedAt,
          sessionCompleted: queue.sessionCompleted,
        }
      : {
          sessionLeadIds: local.sessionLeadIds && local.sessionLeadIds.length > 0
            ? local.sessionLeadIds
            : queue.sessionLeadIds,
          resumeIndex: local.resumeIndex != null ? local.resumeIndex : queue.resumeIndex,
          resumeLeadId: local.resumeLeadId !== undefined ? local.resumeLeadId : queue.resumeLeadId,
          resumeUpdatedAt: local.resumeUpdatedAt || queue.resumeUpdatedAt,
          sessionCompleted: typeof local.sessionCompleted === 'boolean' ? local.sessionCompleted : queue.sessionCompleted,
        }),
  }
}

function dateKey(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function queueLeadText(lead: DialerQueueLead) {
  return [
    lead.full_name,
    lead.phone,
    lead.property_address,
    lead.city,
    lead.state,
    lead.source,
    lead.station,
    lead.priority,
    lead.seller_situation,
  ].filter(Boolean).join(' ').toLowerCase()
}

function daysSince(value: string | null | undefined) {
  if (!value) return null
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  return Math.floor((Date.now() - time) / 86_400_000)
}

function lastContactLabel(value: string | null | undefined) {
  const days = daysSince(value)
  if (days == null) return 'No contact'
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function formatSelectOption(option: string) {
  if (option === 'all') return 'All'
  const sort = QUEUE_SORTS.find((item) => item.id === option)
  if (sort) return sort.label
  return option.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function parseNumberOrNull(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function parseDateLowerBound(value: string): number | null {
  if (!value) return null
  const time = new Date(`${value}T00:00:00`).getTime()
  return Number.isNaN(time) ? null : time
}

function parseDateUpperBound(value: string): number | null {
  if (!value) return null
  const time = new Date(`${value}T23:59:59.999`).getTime()
  return Number.isNaN(time) ? null : time
}

function compactDollars(n: number | null | undefined): string {
  if (!n || n <= 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(', ')
}

function formatActivityTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function activityIcon(type: string, metadata: Record<string, unknown> | null): string {
  if (type === 'call') {
    const md = (metadata || {}) as { direction?: string; outcome?: string; disposition?: string }
    if (md.outcome === 'missed' || md.disposition === 'no_answer') return 'phone_missed'
    if (md.direction === 'outbound') return 'call_made'
    if (md.direction === 'inbound') return 'call_received'
    return 'call'
  }
  if (type === 'sms' || type === 'sms_sent' || type === 'sms_received' || type === 'sms_inbound') return 'chat'
  if (type === 'email') return 'mail'
  if (type === 'note') return 'sticky_note_2'
  if (type === 'task') return 'task_alt'
  if ((metadata as { direction?: string } | null)?.direction === 'outbound') return 'call_made'
  return 'history'
}

function callDirection(metadata: Record<string, unknown> | null): 'inbound' | 'outbound' | 'unknown' {
  const direction = (metadata as { direction?: string } | null)?.direction
  if (direction === 'inbound') return 'inbound'
  if (direction === 'outbound') return 'outbound'
  return 'unknown'
}

function callLegSummary(call: RecentCall): string {
  const md = (call.metadata || {}) as { direction?: string; from?: string; to?: string }
  const direction = callDirection(call.metadata)
  const from = typeof md.from === 'string' ? md.from : null
  const to = typeof md.to === 'string' ? md.to : call.phone

  if (direction === 'outbound' && to) return `To ${formatPhone(to)}`
  if (direction === 'inbound' && from && to) return `From ${formatPhone(from)} → To ${formatPhone(to)}`
  if (direction === 'inbound' && from) return `From ${formatPhone(from)}`
  if (to) return formatPhone(to)
  return 'Unknown number'
}

function DialerPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [leadIds, setLeadIds] = useState<string[]>([])
  const [leads, setLeads] = useState<Record<string, LeadSummary>>({})
  const [prospects, setProspects] = useState<Record<string, ProspectSummary | null>>({})
  const [manifests, setManifests] = useState<Record<string, ManifestShape | null>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [resolveError, setResolveError] = useState<string | null>(null)
  // Becomes true only once currentIndex has been set to the requested start
  // index. We must NOT persist resume state before this, or the first render
  // (currentIndex === 0) overwrites a real resume pointer with 0.
  const [resumeHydrated, setResumeHydrated] = useState(false)

  // Activity feed for current lead
  const [activities, setActivities] = useState<Activity[]>([])
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([])
  const [leftTab, setLeftTab] = useState<'texts' | 'activity' | 'recent_calls'>('texts')
  const currentLeadIdRef = useRef<string | null>(null)

  // Live queue state from telephony-bar
  const [queueState, setQueueState] = useState<QueueState | null>(null)
  const [autoQueueLeadId, setAutoQueueLeadId] = useState<string | null>(null)
  const [durableSession, setDurableSession] = useState<DurableDialerSession | null>(null)
  const [sessionActionPending, setSessionActionPending] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)

  // SMS compose state
  const [smsTarget, setSmsTarget] = useState<{ heirName: string; relation: string; phone: string; prospectPhoneId: string; deceasedOwnerName: string } | null>(null)

  // Session tally (Mojo-style HUD) + mark-lead-dead dialog
  const [sessionDials, setSessionDials] = useState(0)
  const [sessionContacts, setSessionContacts] = useState(0)
  const [showMarkDead, setShowMarkDead] = useState(false)
  const [markDeadReason, setMarkDeadReason] = useState('')
  const [markDeadNotes, setMarkDeadNotes] = useState('')
  const [markDeadBusy, setMarkDeadBusy] = useState(false)
  const [markDeadError, setMarkDeadError] = useState<string | null>(null)

  const currentLeadId: string | null = leadIds[currentIndex] ?? null
  currentLeadIdRef.current = currentLeadId
  const currentLead: LeadSummary | null = currentLeadId ? leads[currentLeadId] ?? null : null
  const currentProspect: ProspectSummary | null = currentLeadId ? prospects[currentLeadId] ?? null : null
  const currentManifest: ManifestShape | null = currentLeadId ? manifests[currentLeadId] ?? null : null
  const sessionSavedListId = params.get('saved_list_id')?.trim() || ''
  const durableSessionId = params.get('session_id')?.trim() || ''
  const sessionCallerId = params.get('caller_id')?.trim() || ''
  const sessionCallerModeParam = params.get('caller_mode')
  const sessionRotateEveryParam = params.get('rotation_every')
  const sessionRotationNumbersParam = params.get('rotation_numbers')
  const sessionRedialCallerId = params.get('redial_caller_id')?.trim() || ''
  const sessionQueueLabelParam = params.get('queue_label')?.trim() || ''
  const sessionCallHammerParam = params.get('call_hammer')
  const sessionUseCallHammer = sessionCallHammerParam === '1'
    ? true
    : sessionCallHammerParam === '0'
    ? false
    : true
  const sessionRingCountParam = params.get('ring_count')
  const sessionRingCount = sessionRingCountParam && Number.isFinite(Number(sessionRingCountParam))
    ? Number(sessionRingCountParam)
    : null
  const sessionCallerPlan = useMemo(() => {
    const plan = normalizeDialerCallerPlan({
      mode: sessionCallerModeParam === 'rotation' ? 'rotation' : 'static',
      staticCallerId: sessionCallerId || DEFAULT_DIALER_CALLER_ID,
      rotationCallerIds: parseCallerIdsCsv(sessionRotationNumbersParam),
      rotateEveryCalls: sessionRotateEveryParam ? Number(sessionRotateEveryParam) : DEFAULT_ROTATION_EVERY_CALLS,
      redialCallerId: sessionRedialCallerId || null,
    }, sessionCallerId || DEFAULT_DIALER_CALLER_ID)
    return plan
  }, [sessionCallerId, sessionCallerModeParam, sessionRotateEveryParam, sessionRotationNumbersParam, sessionRedialCallerId])
  const startIndexParam = params.get('start_index')

  // Resolve cohort → lead_ids
  useEffect(() => {
    async function resolveIds() {
      setLoading(true)
      setResolveError(null)
      if (durableSessionId) {
        try {
          const session = await loadDurableDialerSession(durableSessionId)
          setDurableSession(session)
          setLeadIds(session.leadIds)
          setCurrentIndex(session.currentIndex)
          setSessionDials(session.dialsCompleted)
          setSessionContacts(session.contacts)
          setResumeHydrated(true)
          setLoading(false)
          return
        } catch (sessionError) {
          setResolveError(sessionError instanceof Error ? sessionError.message : 'Could not load the dialer session.')
          setLeadIds([])
          setLoading(false)
          return
        }
      }
      setDurableSession(null)
      const explicit = params.get('lead_ids')
      if (explicit) {
        const ids = explicit.split(',').map((s) => s.trim()).filter(Boolean)
        setLeadIds(ids)
        setLoading(false)
        return
      }
      const cohort = params.get('cohort')
      if (cohort === 'deceased-2-3yr') {
        const response = await fetch('/api/dialer/queue?cohort=deceased-2-3yr&ids_only=1', { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) {
          setResolveError(payload?.error || 'Could not resolve dialer cohort.')
          setLoading(false)
          return
        }
        const ids = Array.isArray(payload.leadIds)
          ? payload.leadIds.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
        setLeadIds(ids)
        setLoading(false)
        return
      }
      setLeadIds([])
      setLoading(false)
    }
    resolveIds()
  }, [durableSessionId, params])

  useEffect(() => {
    if (durableSessionId) return
    if (leadIds.length === 0) return
    const requested = Number(startIndexParam ?? '0')
    const safeIndex = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0
    const timeout = window.setTimeout(() => {
      setCurrentIndex(Math.min(safeIndex, Math.max(leadIds.length - 1, 0)))
      // Resume pointer is now applied — persistence may begin.
      setResumeHydrated(true)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [durableSessionId, leadIds.length, startIndexParam])

  // Batch-load leads + prospects for the cohort
  useEffect(() => {
    if (leadIds.length === 0) return

    async function load() {
      const response = await fetch(`/api/dialer/queue?lead_ids=${encodeURIComponent(leadIds.join(','))}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) {
        setResolveError(payload?.error || 'Could not load dialer leads.')
        setLeads({})
        setProspects({})
        return
      }
      const leadRows = payload.leads as (LeadSummary & DialerQueueLead)[] | null
      const prospectRows = payload.prospects as (ProspectSummary & { lead_id: string })[] | null
      const leadMap: Record<string, LeadSummary> = {}
      ;(leadRows as LeadSummary[] | null)?.forEach((l) => { leadMap[l.id] = l })
      setLeads(leadMap)

      const prospectMap: Record<string, ProspectSummary | null> = {}
      leadIds.forEach((id) => { prospectMap[id] = null })
      ;(prospectRows as (ProspectSummary & { lead_id: string })[] | null)?.forEach((p) => {
        prospectMap[p.lead_id] = p
      })
      setProspects(prospectMap)
    }
    load()
  }, [leadIds])

  // Load manifest + activities for the current lead only (small fetch, refreshed on advance)
  useEffect(() => {
    if (!currentLeadId) return
    const requestedLeadId = currentLeadId
    let cancelled = false
    void loadDialerLeadContext(requestedLeadId)
      .then(({ manifest, activities: nextActivities }) => {
        if (cancelled || currentLeadIdRef.current !== requestedLeadId) return
        setManifests((prev) => ({ ...prev, [requestedLeadId]: manifest }))
        setActivities(nextActivities)
      })
      .catch((error) => console.error('[Dialer] Could not load lead activity', error))
    return () => { cancelled = true }
  }, [currentLeadId])

  const refreshActivities = useCallback(async () => {
    if (!currentLeadId) return
    const requestedLeadId = currentLeadId
    try {
      const nextActivities = await loadDialerActivities(requestedLeadId)
      if (currentLeadIdRef.current === requestedLeadId) setActivities(nextActivities)
    } catch (error) {
      console.error('[Dialer] Could not refresh lead activity', error)
    }
  }, [currentLeadId])

  // Refresh activities when an attempt is logged.
  useEffect(() => {
    function onAttempt(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail || detail.leadId === currentLeadId) refreshActivities()
    }
    window.addEventListener('heir-attempt-logged', onAttempt)
    window.addEventListener('crm:disposition-logged', onAttempt)
    return () => {
      window.removeEventListener('heir-attempt-logged', onAttempt)
      window.removeEventListener('crm:disposition-logged', onAttempt)
    }
  }, [currentLeadId, refreshActivities])

  useEffect(() => {
    if (leadIds.length === 0 || leftTab !== 'recent_calls') return
    async function loadRecentCalls() {
      try {
        const res = await fetch('/api/call-log?limit=50')
        const data = await res.json()
        if (res.ok) setRecentCalls((data.calls as RecentCall[]) || [])
      } catch {}
    }
    loadRecentCalls()
  }, [leadIds.length, leftTab])

  useEffect(() => {
    if (durableSessionId) return
    if (!sessionSavedListId || leadIds.length === 0 || !resumeHydrated) return
    const resumeIndex = Math.min(Math.max(currentIndex, 0), Math.max(leadIds.length - 1, 0))
    const resumeUpdatedAt = new Date().toISOString()
    patchSavedListMeta(sessionSavedListId, {
      callerId: sessionCallerId || undefined,
      sessionLeadIds: leadIds,
      resumeIndex,
      resumeLeadId: leadIds[resumeIndex] || null,
      resumeUpdatedAt,
      sessionCompleted: false,
    })
    const payload = {
      id: sessionSavedListId,
      callerId: sessionCallerId || undefined,
      sessionLeadIds: leadIds,
      resumeIndex,
      resumeLeadId: leadIds[resumeIndex] || null,
      sessionCompleted: false,
    }
    const timeout = window.setTimeout(() => {
      void fetch('/api/dialer/saved-lists', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [durableSessionId, sessionSavedListId, leadIds, currentIndex, sessionCallerId, resumeHydrated])

  // Listen to queue-state events from the telephony bar
  useEffect(() => {
    function onState(e: Event) {
      setQueueState((e as CustomEvent).detail as QueueState)
    }
    window.addEventListener('heir-queue-state', onState)
    return () => window.removeEventListener('heir-queue-state', onState)
  }, [])

  const applyDurableSession = useCallback((session: DurableDialerSession) => {
    setDurableSession(session)
    setLeadIds(session.leadIds)
    setCurrentIndex(session.currentIndex)
    setSessionDials(session.dialsCompleted)
    setSessionContacts(session.contacts)
    if (session.status === 'active' && session.currentLeadId) setAutoQueueLeadId(session.currentLeadId)
    if (session.status === 'completed' || session.status === 'stopped') setAutoQueueLeadId(null)
  }, [])

  useEffect(() => {
    function onSessionState(event: Event) {
      const session = (event as CustomEvent).detail as DurableDialerSession | null
      if (session?.id === durableSessionId) applyDurableSession(session)
    }
    window.addEventListener('dialer-session-state', onSessionState)
    return () => window.removeEventListener('dialer-session-state', onSessionState)
  }, [applyDurableSession, durableSessionId])

  const advance = useCallback((autoQueueNextLead = false) => {
    setCurrentIndex((i) => {
      const next = Math.min(i + 1, leadIds.length - 1)
      if (autoQueueNextLead && next !== i) {
        setAutoQueueLeadId(leadIds[next] || null)
      }
      return next
    })
  }, [leadIds])

  const back = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  const transitionCurrentSession = useCallback(async (
    action: 'pause' | 'resume' | 'stop' | 'skip',
    reason?: string,
  ) => {
    if (!durableSessionId) return null
    setSessionActionPending(true)
    setSessionError(null)
    try {
      const session = await transitionDurableDialerSession(durableSessionId, action, reason)
      applyDurableSession(session)
      return session
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not update the dialer session.')
      return null
    } finally {
      setSessionActionPending(false)
    }
  }, [applyDurableSession, durableSessionId])

  const skipCurrentLead = useCallback(async () => {
    if (!durableSessionId) {
      advance(true)
      return
    }
    await transitionCurrentSession('skip', 'Agent skipped this contact')
  }, [advance, durableSessionId, transitionCurrentSession])

  const handleAutoStartEmpty = useCallback(() => {
    // A record with no callable heirs (never skip-traced, or already fully
    // worked) used to auto-advance here — which cascaded through every such
    // record in a burst and blew past deceased owners the agent still needs to
    // skip-trace. Instead, stop the auto-queue and rest on this record so the
    // agent stays in control (run skip trace, re-call, or press → to move on).
    // Auto-advance to the next record only happens after a record's heirs have
    // actually been called (the heir-queue-complete handler).
    setAutoQueueLeadId(null)
  }, [])

  const navigateAwayFromSession = useCallback(() => {
    const returnTo = params.get('return_to')
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
      router.push(returnTo)
      return
    }
    router.push('/dialer')
  }, [params, router])

  const closeSession = useCallback(async () => {
    if (durableSessionId && durableSession?.status === 'active') {
      const session = await transitionCurrentSession('pause')
      if (!session) return
    }
    if (!durableSessionId && sessionSavedListId && leadIds.length > 0) {
      const resumeIndex = Math.min(Math.max(currentIndex, 0), Math.max(leadIds.length - 1, 0))
      const isCompleted = resumeIndex >= leadIds.length - 1
      patchSavedListMeta(sessionSavedListId, {
        callerId: sessionCallerId || undefined,
        sessionLeadIds: leadIds,
        resumeIndex,
        resumeLeadId: leadIds[resumeIndex] || null,
        resumeUpdatedAt: new Date().toISOString(),
        sessionCompleted: isCompleted,
      })
      void fetch('/api/dialer/saved-lists', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: sessionSavedListId,
          callerId: sessionCallerId || undefined,
          sessionLeadIds: leadIds,
          resumeIndex,
          resumeLeadId: leadIds[resumeIndex] || null,
          sessionCompleted: isCompleted,
        }),
      })
    }

    navigateAwayFromSession()
  }, [currentIndex, durableSession, durableSessionId, leadIds, navigateAwayFromSession, sessionCallerId, sessionSavedListId, transitionCurrentSession])

  const stopSession = useCallback(async () => {
    if (!durableSessionId) {
      navigateAwayFromSession()
      return
    }
    const session = await transitionCurrentSession('stop')
    if (session) navigateAwayFromSession()
  }, [durableSessionId, navigateAwayFromSession, transitionCurrentSession])

  useEffect(() => {
    function onQueueComplete(e: Event) {
      if (durableSessionId) return
      const detail = (e as CustomEvent).detail
      if (detail?.leadId === currentLeadId) {
        setTimeout(() => advance(true), 400)
      }
    }
    window.addEventListener('heir-queue-complete', onQueueComplete)
    return () => window.removeEventListener('heir-queue-complete', onQueueComplete)
  }, [currentLeadId, advance, durableSessionId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); void skipCurrentLead() }
      if (!durableSessionId && (e.key === 'k' || e.key === 'ArrowLeft')) { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, durableSessionId, skipCurrentLead])

  // Tally dials / contacts for the session HUD. crm:disposition-logged fires
  // once per saved call disposition and carries `reached` (the agent actually
  // talked to someone). Header-driven "mark dead" is not a dial, so it does not
  // dispatch this event.
  useEffect(() => {
    function onDispo(e: Event) {
      const detail = (e as CustomEvent).detail as { reached?: boolean } | null
      setSessionDials((n) => n + 1)
      if (detail?.reached) setSessionContacts((n) => n + 1)
    }
    window.addEventListener('crm:disposition-logged', onDispo)
    return () => window.removeEventListener('crm:disposition-logged', onDispo)
  }, [])

  const markLeadDead = useCallback(async () => {
    if (!currentLeadId || !markDeadReason) return
    if (markDeadReason === 'other' && !markDeadNotes.trim()) {
      setMarkDeadError('Add a note when Other is selected.')
      return
    }
    setMarkDeadBusy(true)
    setMarkDeadError(null)
    try {
      const res = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentLeadId,
          station: 'dead',
          dead_reason: markDeadReason,
          dead_at: new Date().toISOString(),
          dead_by: 'Ernest',
          deadReasonNotes: markDeadNotes.trim() || null,
          activity: {
            type: 'status_change',
            disposition: 'dead',
            notes: markDeadNotes.trim() || `Marked dead from dialer — ${markDeadReason.replace(/_/g, ' ')}`,
            agent: 'Ernest',
            dead_reason: markDeadReason,
          },
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Could not mark lead dead')
      }
      setShowMarkDead(false)
      setMarkDeadReason('')
      setMarkDeadNotes('')
      refreshActivities()
      if (durableSessionId) {
        await transitionCurrentSession('skip', `Lead marked dead: ${markDeadReason}`)
      } else {
        advance(true)
      }
    } catch (e) {
      setMarkDeadError(e instanceof Error ? e.message : 'Could not mark lead dead')
    } finally {
      setMarkDeadBusy(false)
    }
  }, [currentLeadId, durableSessionId, markDeadReason, markDeadNotes, advance, refreshActivities, transitionCurrentSession])

  const ownerName = useMemo(() => {
    const raw = currentProspect?.owner_1 || currentLead?.full_name || 'Unknown'
    return toProperCase(raw)
  }, [currentProspect, currentLead])

  const situsAddress = joinAddress([
    currentProspect?.situs_street || currentLead?.property_address,
    currentProspect?.situs_city || currentLead?.city,
    currentProspect?.situs_state || currentLead?.state,
    currentProspect?.situs_zip || currentLead?.zip,
  ])
  // Occupancy status — prefer the manifest's vacant flag, then the mailing vs
  // situs comparison (absentee when tax bill goes somewhere other than the
  // property). Default is owner-occupied when we can tell, null otherwise.
  type Occupancy = { label: 'Vacant' | 'Absentee' | 'Owner occupied'; tone: 'warn' | 'amber' | 'neutral' }
  const occupancy: Occupancy | null = (() => {
    if (currentManifest?.property?.vacant === true) return { label: 'Vacant', tone: 'warn' }
    const mailing = joinAddress([
      currentProspect?.mailing_street,
      currentProspect?.mailing_city,
      currentProspect?.mailing_state,
      currentProspect?.mailing_zip,
    ])
    if (!mailing) return null
    if (mailing !== situsAddress) return { label: 'Absentee', tone: 'amber' }
    return { label: 'Owner occupied', tone: 'neutral' }
  })()

  const coOwners: string[] = (currentManifest?.owner?.coOwners ?? []).filter(Boolean)

  const delinquentYears = currentProspect?.delinquent_years_category === '3yr_plus'
    ? '3+ yr'
    : currentProspect?.delinquent_years_category === '2yr'
    ? '2 yr'
    : null

  const inferredQueueLabel = sessionQueueLabelParam ||
    (params.get('cohort') === 'deceased-2-3yr'
      ? '3+ Year Deceased Tax'
      : delinquentYears
      ? `${delinquentYears} deceased tax list`
      : 'Dialer queue')
  const commsEvents = useMemo(() => buildCommsTimeline(activities), [activities])
  const commsSummary = useMemo(() => summarizeComms(commsEvents), [commsEvents])

  if (!loading && leadIds.length === 0 && !resolveError) {
    return <DialerHome />
  }

  if (resolveError) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-6">
        <div className="ck-card p-8 max-w-md text-center">
          <Icon name="error_outline" className="!text-4xl text-[#E32E2E] mb-3" />
          <p className="text-sm font-bold text-[var(--ck-text)] mb-2">Cannot start a dialing session</p>
          <p className="text-xs text-[var(--ck-text-muted)] mb-6">{resolveError}</p>
          <Link
            href="/contacts"
            className="inline-flex items-center gap-2 bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
          >
            <Icon name="arrow_back" size="text-sm" /> Back to contacts
          </Link>
        </div>
      </div>
    )
  }

  if (loading || leadIds.length === 0) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Icon name="progress_activity" className="!text-4xl text-[var(--ck-text-dim)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24">
      <DialerSessionCommand
        queueLabel={inferredQueueLabel}
        currentIndex={currentIndex}
        queueSize={leadIds.length}
        callerId={sessionCallerId}
        durableSessionId={durableSessionId}
        durableStatus={durableSession?.status}
        dials={sessionDials}
        contacts={sessionContacts}
        queueState={queueState}
        actionPending={sessionActionPending}
        currentLeadId={currentLeadId}
        error={sessionError}
        onClose={() => { void closeSession() }}
        onResume={() => { void transitionCurrentSession('resume') }}
        onStop={() => { void stopSession() }}
        onMarkDead={() => { setMarkDeadReason(''); setMarkDeadNotes(''); setMarkDeadError(null); setShowMarkDead(true) }}
        onPrevious={back}
        onSkip={() => { void skipCurrentLead() }}
      />

      {/* Two-column body */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* LEFT — property context + activity */}
        <div className="col-span-12 lg:col-span-5 space-y-4">
          <section className="ck-card p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)] mb-1">
                  Subject property
                </p>
                <h1 className="text-xl font-black text-[var(--ck-text)] leading-tight truncate">
                  {currentProspect?.situs_street || currentLead?.property_address || '—'}
                </h1>
                <p className="text-sm text-[var(--ck-text-muted)] mt-0.5">
                  {joinAddress([currentProspect?.situs_city || currentLead?.city, currentProspect?.situs_state || currentLead?.state])}
                  {(currentProspect?.situs_zip || currentLead?.zip) ? ` ${currentProspect?.situs_zip || currentLead?.zip}` : ''}
                </p>
              </div>
              <Link
                href={`/leads/${currentLeadId}`}
                prefetch={false}
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] rounded-md px-2 py-1 transition-colors"
                title="Open full lead profile in a new tab"
                target="_blank"
              >
                Profile <Icon name="open_in_new" size="text-xs" />
              </Link>
            </div>


            {/* Deceased owner + co-owners + taxpayer */}
            <div className="mb-4 p-3 rounded-lg bg-[#E32E2E]/10 border border-[#E32E2E]/30">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#E32E2E] mb-1">
                Owner of record
              </p>
              <p className="text-sm font-bold text-[var(--ck-text)]">{ownerName}</p>
              <p className="text-[10px] text-[var(--ck-text-dim)] uppercase tracking-wider mt-0.5">Deceased · tax bill is in this name</p>
              {coOwners.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#E32E2E]/20">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)] mb-1.5">
                    Co-owners on title
                  </p>
                  <ul className="space-y-0.5">
                    {coOwners.map((name) => (
                      <li key={name} className="text-xs text-[var(--ck-text)] flex items-center gap-1.5">
                        <Icon name="person" size="text-xs" className="text-[var(--ck-text-dim)]" />
                        {toProperCase(name)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Signal chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              {occupancy && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${
                    occupancy.tone === 'warn'
                      ? 'bg-[#E32E2E]/15 border-[#E32E2E]/40 text-[#E32E2E]'
                      : occupancy.tone === 'amber'
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  }`}
                >
                  {occupancy.label}
                </span>
              )}
              {currentProspect?.county && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] text-[var(--ck-text-muted)]">
                  {currentProspect.county} county
                </span>
              )}
              {delinquentYears && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  {delinquentYears} delinquent
                </span>
              )}
              {currentProspect?.earliest_delinquent_year && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] text-[var(--ck-text-muted)]">
                  since {currentProspect.earliest_delinquent_year}
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="ck-card-elev p-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)] mb-1">Taxes owed</p>
                <p className="text-lg font-black text-[#E32E2E] tabular-nums">{compactDollars(currentProspect?.cumulative_due)}</p>
              </div>
              <div className="ck-card-elev p-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)] mb-1">Zestimate</p>
                <p className="text-lg font-black text-[var(--ck-text)] tabular-nums">{compactDollars(currentProspect?.zestimate)}</p>
              </div>
              <div className="ck-card-elev p-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)] mb-1">Market</p>
                <p className="text-lg font-black text-[var(--ck-text)] tabular-nums">{compactDollars(currentProspect?.total_market_value)}</p>
              </div>
            </div>
          </section>

          {currentLead ? <DialerAiAssist lead={currentLead} activities={activities} /> : null}

          {/* Text thread + activity + recent call history */}
          <section className="ck-card p-5">
            <div className="flex items-center justify-between mb-3 gap-3">
              <div className="inline-flex rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-0.5">
                <button
                  type="button"
                  onClick={() => setLeftTab('texts')}
                  className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${
                    leftTab === 'texts'
                      ? 'bg-[#E32E2E] text-white'
                      : 'text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]'
                  }`}
                >
                  Text Hub
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab('activity')}
                  className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${
                    leftTab === 'activity'
                      ? 'bg-[#E32E2E] text-white'
                      : 'text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]'
                  }`}
                >
                  Communications
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab('recent_calls')}
                  className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${
                    leftTab === 'recent_calls'
                      ? 'bg-[#E32E2E] text-white'
                      : 'text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]'
                  }`}
                >
                  Recent Calls
                </button>
              </div>
              <span className="text-[10px] text-[var(--ck-text-dim)]">
                {leftTab === 'texts'
                  ? `${commsSummary.sms} texts`
                  : leftTab === 'activity'
                  ? `${commsEvents.length} touches`
                  : `${recentCalls.length} recent`}
              </span>
            </div>
            {leftTab === 'texts' && currentLeadId ? (
              <SmsThreadPanel
                leadId={currentLeadId}
                leadName={ownerName}
                phone={currentLead?.phone}
                propertyAddress={situsAddress}
                activities={activities}
                defaultFromPhone={sessionCallerId || null}
                agent="Ernest"
                onRefresh={refreshActivities}
              />
            ) : leftTab === 'activity' ? (
              <div className="space-y-3">
                <CommsSummaryBar summary={commsSummary} />
                <div className="border-t border-[var(--ck-border)] pt-3">
                  <CommsTimeline events={commsEvents} emptyHint="No calls, texts, or emails logged for this lead yet." />
                </div>
              </div>
            ) : recentCalls.length === 0 ? (
              <p className="text-xs text-[var(--ck-text-dim)] italic py-4 text-center">No recent calls logged yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {recentCalls.map((c) => {
                  const md = (c.metadata ?? {}) as {
                    direction?: string
                    duration?: number
                    disposition?: string
                    outcome?: string
                    status?: string
                    from?: string
                    to?: string
                    callStatus?: string
                    dialStatus?: string
                  }
                  const direction = callDirection(c.metadata)
                  const noAnswer =
                    md.disposition === 'no_answer' ||
                    md.outcome === 'missed' ||
                    md.callStatus === 'no-answer' ||
                    md.callStatus === 'busy' ||
                    md.dialStatus === 'no-answer' ||
                    md.dialStatus === 'busy'
                  const missedCall = md.outcome === 'missed' || md.callStatus === 'no-answer' || md.dialStatus === 'no-answer'
                  const completed = md.status === 'completed' || (typeof md.duration === 'number' && md.duration > 0) || md.disposition === 'answered' || md.outcome === 'connected'
                  const pending = md.status === 'initiated' || md.status === 'ringing' || md.status === 'queued'
                  const voicemail = md.disposition === 'voicemail_left' || md.disposition === 'left_voicemail'
                  const leftTone =
                    direction === 'outbound'
                      ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
                      : direction === 'inbound'
                      ? 'bg-cyan-500/15 border-cyan-500/25 text-cyan-300'
                      : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)] text-[var(--ck-text-muted)]'
                  const detailParts = [callLegSummary(c)]
                  if (c.agent) detailParts.push(c.agent)
                  if (md.disposition) detailParts.push(md.disposition.replace(/_/g, ' '))
                  const detail = detailParts.join(' · ')
                  return (
                    <li key={c.id} className="flex items-start gap-3">
                      <span className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center mt-0.5 ${leftTone}`}>
                        <Icon name={activityIcon('call', c.metadata)} size="text-xl" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm text-[var(--ck-text)] font-semibold truncate">{c.lead_name || c.phone || 'Unknown'}</p>
                          <span className="text-[10px] text-[var(--ck-text-dim)] shrink-0">{formatActivityTime(c.created_at)}</span>
                        </div>
                        <p className="text-[11px] text-[var(--ck-text-muted)] truncate">{detail}</p>
                      </div>
                      {noAnswer ? (
                        <span className="shrink-0 w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                          <Icon name={missedCall ? 'missed_call_badge' : 'no_answer_badge'} size="text-xl" />
                        </span>
                      ) : voicemail ? (
                        <span className="shrink-0 w-11 h-11 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center">
                          <Icon name="support_agent" size="text-xl" />
                        </span>
                      ) : completed ? (
                        <span className="shrink-0 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-2 py-1.5 text-emerald-300 inline-flex items-center gap-1.5 min-w-[62px] justify-center">
                          <Icon name="check_circle" size="text-base" />
                          <span className="text-xs font-bold tabular-nums">{typeof md.duration === 'number' && md.duration > 0 ? `${Math.floor(md.duration / 60)}:${String(md.duration % 60).padStart(2, '0')}` : 'done'}</span>
                        </span>
                      ) : pending ? (
                        <span className="shrink-0 w-11 h-11 rounded-xl bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] text-[var(--ck-text-muted)] flex items-center justify-center">
                          <Icon name="more_horiz" size="text-xl" />
                        </span>
                      ) : (
                        <span className="shrink-0 w-11 h-11 rounded-xl bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] text-[var(--ck-text-muted)] flex items-center justify-center">
                          <Icon name="help" size="text-xl" />
                        </span>
                      )}
                    </li>
                )})}
              </ul>
            )}
          </section>

          {/* Progress ribbon */}
          <section className="ck-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Progress</p>
              <p className="text-[10px] font-bold text-[var(--ck-text-muted)] tabular-nums">
                {currentIndex + 1} / {leadIds.length}
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--ck-surface-hi)] overflow-hidden">
              <div
                className="h-full bg-[#E32E2E] transition-all"
                style={{ width: `${Math.round(((currentIndex + 1) / leadIds.length) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-[var(--ck-text-dim)] mt-3">
              <kbd className="text-[9px] font-mono bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded px-1">J</kbd> next ·
              <kbd className="text-[9px] font-mono bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded px-1 ml-1">K</kbd> prev
            </p>
          </section>
        </div>

        {/* RIGHT — heirs + dial queue */}
        <div className="col-span-12 lg:col-span-7">
          {currentLeadId && (
            <HeirsSection
              key={currentLeadId}
              leadId={currentLeadId}
              deceasedOwnerName={ownerName}
              propertyAddress={situsAddress}
              dialerCallerId={sessionCallerId || null}
              dialerCallerPlan={sessionCallerPlan}
              callHammerEnabled={sessionUseCallHammer}
              ringCount={sessionRingCount}
              dialerSessionId={durableSessionId || null}
              autoStart={autoQueueLeadId === currentLeadId}
              onAutoStartHandled={() => setAutoQueueLeadId(null)}
              onAutoStartEmpty={handleAutoStartEmpty}
              defaultExpanded
              collapsible={false}
              onSmsPhone={setSmsTarget}
            />
          )}
        </div>
      </div>

      {/* SMS composer — pinned to the property lead so the SMS logs there. */}
      {smsTarget && currentLeadId && currentLead && (
        <SmsComposeModal
          lead={{
            id: currentLead.id,
            full_name: smsTarget.heirName,
            phone: smsTarget.phone,
            email: null,
            property_address: situsAddress,
            assigned_agent: null,
            city: currentLead.city,
            state: currentLead.state,
            zip: currentLead.zip,
          }}
          initialTab="sms"
          conversationSource="heir_dialer"
          prospectPhoneId={smsTarget.prospectPhoneId}
          heirName={smsTarget.heirName}
          heirRelation={smsTarget.relation}
          prospectOwnerName={smsTarget.deceasedOwnerName}
          defaultFromPhone={sessionCallerId || null}
          onClose={() => setSmsTarget(null)}
          onSent={() => { setSmsTarget(null); refreshActivities() }}
        />
      )}

      {/* Mark lead dead — captures the why, sets station=dead, advances. */}
      {showMarkDead && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close"
            onClick={() => !markDeadBusy && setShowMarkDead(false)}
            className="absolute inset-0 bg-black/55 backdrop-blur-[6px]"
          />
          <div className="relative z-[1] w-full max-w-[440px] rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-[var(--ck-border)] px-5 py-4">
              <span className="w-9 h-9 rounded-lg bg-[#E32E2E]/15 text-[#ff7777] flex items-center justify-center">
                <Icon name="cancel" size="text-lg" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black text-[var(--ck-text)] leading-tight">Mark lead dead</p>
                <p className="text-xs text-[var(--ck-text-muted)] truncate">{ownerName} · {situsAddress || 'this property'}</p>
              </div>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)] mb-2">
                Why is it dead? <span className="text-[#ff7777]">Required</span>
              </p>
              <div className="grid grid-cols-1 gap-1.5 max-h-[280px] overflow-auto pr-1">
                {DEAD_REASONS.map((reason) => {
                  const picked = markDeadReason === reason.id
                  return (
                    <button
                      key={reason.id}
                      type="button"
                      onClick={() => { setMarkDeadReason(reason.id); setMarkDeadError(null) }}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm transition-colors border ${
                        picked
                          ? 'bg-[#E32E2E]/15 border-[#E32E2E]/45 text-[var(--ck-text)] font-semibold'
                          : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] hover:border-[var(--ck-border-strong)]'
                      }`}
                    >
                      <Icon name={picked ? 'radio_button_checked' : 'radio_button_unchecked'} size="text-base" className={picked ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'} />
                      {reason.label}
                    </button>
                  )
                })}
              </div>
              <label className="mt-4 block text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">
                Notes {markDeadReason === 'other' ? <span className="text-[#ff7777]">Required</span> : <span className="normal-case tracking-normal">Optional</span>}
                <textarea
                  value={markDeadNotes}
                  onChange={(event) => { setMarkDeadNotes(event.target.value); setMarkDeadError(null) }}
                  rows={3}
                  placeholder="Add context an agent or AI will need later…"
                  className="mt-2 w-full resize-none rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                />
              </label>
              {markDeadError && <p className="mt-3 text-xs font-bold text-[#ff7777]">{markDeadError}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-[var(--ck-border)] px-5 py-4">
              <button
                onClick={() => setShowMarkDead(false)}
                disabled={markDeadBusy}
                className="rounded-lg border border-[var(--ck-border)] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] hover:border-[var(--ck-border-strong)] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={markLeadDead}
                disabled={!markDeadReason || (markDeadReason === 'other' && !markDeadNotes.trim()) || markDeadBusy}
                className="rounded-lg bg-[#E32E2E] hover:bg-[#C42626] px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {markDeadBusy ? 'Saving…' : 'Mark dead & next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type DialerHomeSection = 'overview' | 'queue' | 'sessions' | 'analytics' | 'settings'

const DIALER_HOME_SECTIONS = new Set<DialerHomeSection>(['overview', 'queue', 'sessions', 'analytics', 'settings'])

function DialerPageHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--crm-brand)]">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--crm-ink)]">{title}</h1>
        <p className="mt-1 text-sm text-[var(--crm-text-muted)]">{copy}</p>
      </div>
      {action}
    </div>
  )
}

function DialerOverview({
  loading,
  readyCount,
  scheduledCount,
  followupCount,
  priorityCount,
  staleCount,
  callsToday,
  uniqueLeadsToday,
  activeSessions,
  focusLeads,
  onOpenQueue,
  onResume,
  lastContactByLeadId,
}: {
  loading: boolean
  readyCount: number
  scheduledCount: number
  followupCount: number
  priorityCount: number
  staleCount: number
  callsToday: number
  uniqueLeadsToday: number
  activeSessions: SavedDialerQueue[]
  focusLeads: DialerQueueLead[]
  onOpenQueue: (preset: QueuePreset) => void
  onResume: (queue: SavedDialerQueue) => void
  lastContactByLeadId: Map<string, string>
}) {
  const focusQueues: Array<{ preset: QueuePreset; label: string; copy: string; count: number; icon: string; tone: string }> = [
    { preset: 'followups_today', label: 'Follow-ups due', copy: 'Callbacks and next actions that need attention now.', count: followupCount, icon: 'event_upcoming', tone: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
    { preset: 'scheduled_today', label: 'Scheduled today', copy: 'Appointments and calendar commitments for today.', count: scheduledCount, icon: 'today', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
    { preset: 'priority', label: 'Priority sellers', copy: 'High-intent and high-motivation contacts.', count: priorityCount, icon: 'local_fire_department', tone: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' },
    { preset: 'stale_30', label: 'Re-engage 30+ days', copy: 'Callable records without a recent touch.', count: staleCount, icon: 'history', tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
  ]
  const activeSession = activeSessions[0] ?? null

  return (
    <div>
      <DialerPageHeading
        eyebrow="Acquisitions call command"
        title="Dialer overview"
        copy="Start with the work that matters, resume where you stopped, and see today’s calling load at a glance."
        action={
          <button type="button" onClick={() => onOpenQueue('followups_today')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--crm-brand)] px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-[var(--crm-brand-hover)]">
            <Icon name="phone_in_talk" className="text-lg" /> Review today&apos;s queue
          </button>
        }
      />

      <section aria-label="Dialer readiness" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Ready to call', value: loading ? '—' : readyCount.toLocaleString(), icon: 'contacts', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
          { label: 'Follow-ups due', value: loading ? '—' : followupCount.toLocaleString(), icon: 'notification_important', tone: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
          { label: 'Dials logged today', value: callsToday.toLocaleString(), icon: 'call', tone: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' },
          { label: 'Unique leads touched', value: uniqueLeadsToday.toLocaleString(), icon: 'person_check', tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
        ].map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${metric.tone}`}><Icon name={metric.icon} className="text-xl" /></span>
              <span className="text-3xl font-black tabular-nums text-[var(--crm-ink)]">{metric.value}</span>
            </div>
            <p className="mt-4 text-xs font-bold text-[var(--crm-text-muted)]">{metric.label}</p>
          </div>
        ))}
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="overflow-hidden rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--crm-border)] px-5 py-4">
            <div><h2 className="text-lg font-black text-[var(--crm-ink)]">Work next</h2><p className="mt-0.5 text-xs text-[var(--crm-text-muted)]">Queues ranked by urgency and seller intent.</p></div>
            <Link href="/dialer?section=queue" className="text-xs font-black text-[var(--crm-brand)] hover:underline">Build custom queue</Link>
          </div>
          <div className="grid gap-px bg-[var(--crm-border)] sm:grid-cols-2">
            {focusQueues.map((item) => (
              <button key={item.preset} type="button" onClick={() => onOpenQueue(item.preset)} className="group flex min-h-36 flex-col items-start bg-[var(--crm-surface)] p-5 text-left transition-colors hover:bg-[var(--crm-surface-subtle)]">
                <div className="flex w-full items-start justify-between gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.tone}`}><Icon name={item.icon} className="text-xl" /></span>
                  <span className="text-2xl font-black tabular-nums text-[var(--crm-ink)]">{loading ? '—' : item.count}</span>
                </div>
                <p className="mt-4 text-sm font-black text-[var(--crm-ink)]">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">{item.copy}</p>
                <span className="mt-auto pt-3 text-xs font-black text-[var(--crm-brand)]">Review queue <Icon name="arrow_forward" className="ml-1 inline text-sm transition-transform group-hover:translate-x-0.5" /></span>
              </button>
            ))}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black text-[var(--crm-ink)]">Resume session</h2><Icon name="play_circle" className="text-2xl text-[var(--crm-brand)]" /></div>
            {activeSession ? (
              <>
                <p className="mt-4 text-sm font-black text-[var(--crm-ink)]">{activeSession.name}</p>
                <p className="mt-1 text-xs text-[var(--crm-text-muted)]">{Math.max(activeSession.sessionLeadIds.length - activeSession.resumeIndex, 0)} contacts remaining · {activeSession.agent}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><div className="h-full rounded-full bg-[var(--crm-brand)]" style={{ width: `${Math.round((activeSession.resumeIndex / Math.max(activeSession.sessionLeadIds.length, 1)) * 100)}%` }} /></div>
                <button type="button" onClick={() => onResume(activeSession)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--crm-brand)] px-3 py-2.5 text-xs font-black text-white hover:bg-[var(--crm-brand-hover)]"><Icon name="resume" className="text-base" />Resume at {activeSession.resumeIndex + 1}</button>
              </>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface-subtle)] p-4 text-center">
                <p className="text-sm font-bold text-[var(--crm-ink)]">No paused session</p><p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Start from a saved queue and your place will appear here.</p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between"><h2 className="text-lg font-black text-[var(--crm-ink)]">First calls</h2><span className="text-xs font-bold text-[var(--crm-text-muted)]">Priority order</span></div>
            <div className="mt-3 divide-y divide-[var(--crm-border)]">
              {focusLeads.slice(0, 4).map((lead, index) => (
                <div key={lead.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--crm-surface-subtle)] text-[10px] font-black text-[var(--crm-text-muted)]">{index + 1}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-[var(--crm-ink)]">{toProperCase(lead.full_name) || 'Unknown lead'}</p><p className="mt-0.5 truncate text-[11px] text-[var(--crm-text-muted)]">{lead.property_address || lead.city || 'No address'} · {lastContactLabel(lastContactByLeadId.get(lead.id))}</p></div>
                  <span className="text-[10px] font-black uppercase text-[var(--crm-brand)]">{lead.priority || 'ready'}</span>
                </div>
              ))}
              {!loading && focusLeads.length === 0 ? <p className="py-4 text-center text-xs text-[var(--crm-text-muted)]">No callable records are ready.</p> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function DialerSessionsView({ savedQueues, onResume, onOpenQueue }: { savedQueues: SavedDialerQueue[]; onResume: (queue: SavedDialerQueue) => void; onOpenQueue: (preset: QueuePreset) => void }) {
  const active = savedQueues.filter((queue) => queue.sessionLeadIds.length > 0 && !queue.sessionCompleted)
  const completed = savedQueues.filter((queue) => queue.sessionCompleted)
  return (
    <div>
      <DialerPageHeading eyebrow="Dialer sessions" title="Pick up without rebuilding" copy="Paused sessions keep their order, calling number, filters, and exact resume point." action={<button type="button" onClick={() => onOpenQueue('custom')} className="rounded-lg bg-[var(--crm-brand)] px-4 py-2.5 text-sm font-black text-white hover:bg-[var(--crm-brand-hover)]">New calling session</button>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm">
          <h2 className="text-lg font-black text-[var(--crm-ink)]">Active and paused</h2>
          <div className="mt-4 space-y-3">
            {active.map((queue) => (
              <div key={queue.id} className="flex flex-col gap-4 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4 sm:flex-row sm:items-center">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="phone_in_talk" className="text-xl" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-[var(--crm-ink)]">{queue.name}</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{queue.resumeIndex + 1} of {queue.sessionLeadIds.length} · {queue.agent} · {formatPhone(queue.callerId)}</p></div>
                <button type="button" onClick={() => onResume(queue)} className="rounded-lg bg-[var(--crm-brand)] px-4 py-2 text-xs font-black text-white hover:bg-[var(--crm-brand-hover)]">Resume · {Math.max(queue.sessionLeadIds.length - queue.resumeIndex, 0)} left</button>
              </div>
            ))}
            {active.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--crm-border-strong)] p-8 text-center"><Icon name="pause_circle" className="text-3xl text-[var(--crm-text-dim)]" /><p className="mt-2 text-sm font-bold text-[var(--crm-ink)]">No paused sessions</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Start a queue and your progress will be saved here.</p></div> : null}
          </div>
        </section>
        <aside className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm"><h2 className="text-lg font-black text-[var(--crm-ink)]">Completed sessions</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Recent saved-list sessions marked complete.</p><p className="mt-5 text-4xl font-black text-[var(--crm-ink)]">{completed.length}</p><Link href="/dialer?section=analytics" className="mt-5 inline-flex items-center gap-1 text-xs font-black text-[var(--crm-brand)]">Review dialer activity <Icon name="arrow_forward" className="text-sm" /></Link></aside>
      </div>
    </div>
  )
}

function DialerAnalyticsView({ callsToday, uniqueLeadsToday, followupCount, readyCount, contactActivities }: { callsToday: number; uniqueLeadsToday: number; followupCount: number; readyCount: number; contactActivities: QueueContactActivity[] }) {
  const sevenDayCalls = contactActivities.filter((activity) => ['call', 'voicemail'].includes(activity.activity_type) && daysSince(activity.created_at) != null && (daysSince(activity.created_at) || 0) <= 7).length
  const coverage = readyCount > 0 ? Math.min(100, Math.round((uniqueLeadsToday / readyCount) * 100)) : 0
  return (
    <div>
      <DialerPageHeading eyebrow="Dialer performance" title="Calling activity" copy="Operational activity only—connection and conversion rates appear once dispositions are captured consistently." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Dials today', callsToday, 'call'], ['Unique leads today', uniqueLeadsToday, 'person_check'], ['Dials in 7 days', sevenDayCalls, 'date_range'], ['Follow-ups due', followupCount, 'event_upcoming'],
      ].map(([label, value, icon]) => <div key={label as string} className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm"><Icon name={icon as string} className="text-2xl text-[var(--crm-brand)]" /><p className="mt-4 text-3xl font-black text-[var(--crm-ink)]">{value as number}</p><p className="mt-1 text-xs font-bold text-[var(--crm-text-muted)]">{label as string}</p></div>)}</div>
      <section className="mt-5 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm"><div className="flex items-end justify-between"><div><h2 className="text-lg font-black text-[var(--crm-ink)]">Today&apos;s queue coverage</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Unique leads touched compared with currently callable records.</p></div><strong className="text-2xl font-black text-[var(--crm-ink)]">{coverage}%</strong></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><div className="h-full rounded-full bg-[var(--crm-brand)]" style={{ width: `${coverage}%` }} /></div><div className="mt-5 rounded-xl border border-[var(--crm-info)]/25 bg-[var(--crm-info-soft)] p-4 text-sm leading-6 text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">Metric safeguard:</strong> this page does not infer contacts, appointments, or conversions from raw dial events. Those outcomes require a saved disposition so the reporting remains trustworthy.</div></section>
    </div>
  )
}

function DialerSettingsView({ callerId, setCallerId, ringCount, setRingCount }: { callerId: string; setCallerId: (value: string) => void; ringCount: number; setRingCount: (value: number) => void }) {
  return (
    <div>
      <DialerPageHeading eyebrow="Dialer controls" title="Session defaults" copy="Set the caller ID and ring timing used by the single-line calling queue." />
      <section className="max-w-3xl rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-6 shadow-sm">
        <div className="grid gap-5 sm:grid-cols-2">
          <label><span className="text-xs font-bold text-[var(--crm-ink)]">Default calling number</span><select value={callerId} onChange={(event) => setCallerId(event.target.value)} className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm font-semibold text-[var(--crm-ink)]">{TWILIO_NUMBERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span className="text-xs font-bold text-[var(--crm-ink)]">Rings before no answer</span><select value={ringCount} onChange={(event) => setRingCount(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm font-semibold text-[var(--crm-ink)]">{[3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value} rings</option>)}</select></label>
        </div>
        <div className="mt-6 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4">
          <p className="text-sm font-black text-[var(--crm-ink)]">Single-line calling</p>
          <p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Calls run one number at a time. After each saved outcome, the session advances to the next callable number.</p>
        </div>
        <p className="mt-5 text-xs leading-5 text-[var(--crm-text-muted)]">These defaults apply to the current workspace session. Save a calling list to persist its queue-specific configuration and resume point.</p>
      </section>
    </div>
  )
}

function DialerHome() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [leads, setLeads] = useState<DialerQueueLead[]>([])
  const [followups, setFollowups] = useState<QueueFollowup[]>([])
  const [contactActivities, setContactActivities] = useState<QueueContactActivity[]>([])
  const [prospects, setProspects] = useState<QueueProspect[]>([])
  const [callingWindowOpen, setCallingWindowOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<QueuePreset>('custom')
  const [campaign, setCampaign] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [minMotivation, setMinMotivation] = useState(0)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<QueueSort>('recommended')
  const [visibleLimit, setVisibleLimit] = useState(25)
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set())
  const [savedQueues, setSavedQueues] = useState<SavedDialerQueue[]>([])
  const [savedQueueName, setSavedQueueName] = useState('')
  const [activeSavedQueueId, setActiveSavedQueueId] = useState('')
  const [savedQueueError, setSavedQueueError] = useState<string | null>(null)
  const [showQueueControls, setShowQueueControls] = useState(false)
  const [showSavedLists, setShowSavedLists] = useState(false)
  const [showAdvancedNumbers, setShowAdvancedNumbers] = useState(false)
  const [showOptionalFilters, setShowOptionalFilters] = useState(false)
  const [showWizardAdvanced, setShowWizardAdvanced] = useState(false)
  const [agent, setAgent] = useState('Casey')
  const [callerId, setCallerId] = useState<string>(DEFAULT_DIALER_CALLER_ID)
  const [callerMode, setCallerMode] = useState<CallerIdMode>('static')
  const [rotationCallerIds, setRotationCallerIds] = useState<string[]>(() => DEFAULT_DIALER_CALLER_ID ? [DEFAULT_DIALER_CALLER_ID] : [])
  const [rotateEveryCalls, setRotateEveryCalls] = useState(DEFAULT_ROTATION_EVERY_CALLS)
  const [redialCallerId, setRedialCallerId] = useState('')
  const [startBehavior, setStartBehavior] = useState<'resume' | 'top'>('resume')
  const [optionalFilters, setOptionalFilters] = useState<OptionalDialingFilters>(DEFAULT_OPTIONAL_FILTERS)
  const [optionalFiltersDraft, setOptionalFiltersDraft] = useState<OptionalDialingFilters>(DEFAULT_OPTIONAL_FILTERS)
  const [ringCount, setRingCount] = useState(6)
  const [useCallHammer, setUseCallHammer] = useState(true)
  const [useVoicemailCallHammer, setUseVoicemailCallHammer] = useState(false)
  const [showBulkSms, setShowBulkSms] = useState(false)
  const requestedSection = searchParams.get('section') as DialerHomeSection | null
  const homeSection: DialerHomeSection = requestedSection && DIALER_HOME_SECTIONS.has(requestedSection) ? requestedSection : 'overview'

  useEffect(() => {
    if (!callerId && DEFAULT_DIALER_CALLER_ID) {
      const timeout = window.setTimeout(() => setCallerId(DEFAULT_DIALER_CALLER_ID), 0)
      return () => window.clearTimeout(timeout)
    }
  }, [callerId])

  useEffect(() => {
    if (rotationCallerIds.length === 0 && callerId) {
      const timeout = window.setTimeout(() => setRotationCallerIds([callerId]), 0)
      return () => window.clearTimeout(timeout)
    }
  }, [rotationCallerIds.length, callerId])

  const loadSavedQueues = useCallback(async () => {
    setSavedQueueError(null)
    try {
      const serverQueues = await loadDialerSavedQueuesWithOpenSession() as unknown as SavedDialerQueue[]
      setSavedQueues(serverQueues.map((queue) => queue.durableSessionId ? queue : mergeSavedQueueWithLocalMeta(queue)))
    } catch {
      setSavedQueueError('Could not load saved lists.')
      setSavedQueues([])
    }
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/dialer/queue', { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) {
          setError(payload?.error || 'Could not load dialer queue.')
          setLeads([])
          setFollowups([])
          setContactActivities([])
          setProspects([])
          setCallingWindowOpen(false)
          setLoading(false)
          return
        }
        setLeads((payload.leads as DialerQueueLead[] | null) ?? [])
        setFollowups((payload.followups as QueueFollowup[] | null) ?? [])
        setContactActivities((payload.contactActivities as QueueContactActivity[] | null) ?? [])
        setProspects((payload.prospects as QueueProspect[] | null) ?? [])
        setCallingWindowOpen(payload.queuePolicy?.callingWindowOpen === true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load dialer queue.')
        setLeads([])
        setFollowups([])
        setContactActivities([])
        setProspects([])
        setCallingWindowOpen(false)
      }
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadSavedQueues() }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadSavedQueues])

  const today = dateKey(new Date().toISOString())
  const followupLeadIds = useMemo(() => {
    return new Set(followups
      .filter((task) => {
        const status = task.metadata?.status || 'pending'
        const dueDate = dateKey(task.metadata?.due_date)
        return status !== 'completed' && Boolean(dueDate) && dueDate <= today
      })
      .map((task) => task.lead_id)
      .filter(Boolean) as string[])
  }, [followups, today])

  const scheduledTodayLeadIds = useMemo(() => {
    const ids = new Set<string>()
    followups.forEach((task) => {
      const status = task.metadata?.status || 'pending'
      if (status === 'completed') return
      if (dateKey(task.metadata?.due_date) === today && task.lead_id) ids.add(task.lead_id)
    })
    leads.forEach((lead) => {
      if (dateKey(lead.appointment_date) === today) ids.add(lead.id)
    })
    return ids
  }, [followups, leads, today])

  const lastContactByLeadId = useMemo(() => {
    const map = new Map<string, string>()
    contactActivities.forEach((activity) => {
      if (!activity.lead_id) return
      const current = map.get(activity.lead_id)
      if (!current || new Date(activity.created_at).getTime() > new Date(current).getTime()) {
        map.set(activity.lead_id, activity.created_at)
      }
    })
    return map
  }, [contactActivities])

  const callAttemptCountByLeadId = useMemo(() => {
    const map = new Map<string, number>()
    contactActivities.forEach((activity) => {
      if (!activity.lead_id) return
      if (activity.activity_type !== 'call' && activity.activity_type !== 'voicemail') return
      map.set(activity.lead_id, (map.get(activity.lead_id) || 0) + 1)
    })
    return map
  }, [contactActivities])

  const lastDialedByLeadId = useMemo(() => {
    const map = new Map<string, string>()
    contactActivities.forEach((activity) => {
      if (!activity.lead_id) return
      if (activity.activity_type !== 'call' && activity.activity_type !== 'voicemail') return
      const current = map.get(activity.lead_id)
      if (!current || new Date(activity.created_at).getTime() > new Date(current).getTime()) {
        map.set(activity.lead_id, activity.created_at)
      }
    })
    return map
  }, [contactActivities])

  const prospectByLeadId = useMemo(() => {
    const map = new Map<string, QueueProspect[]>()
    prospects.forEach((prospect) => {
      if (!prospect.lead_id) return
      map.set(prospect.lead_id, [...(map.get(prospect.lead_id) ?? []), prospect])
    })
    return map
  }, [prospects])

  const sourceOptions = useMemo(() => {
    return ['all', ...Array.from(new Set(leads.map((lead) => lead.source).filter(Boolean) as string[])).sort()]
  }, [leads])

  const statusOptions = useMemo(() => {
    return ['all', ...Array.from(new Set(leads.map((lead) => lead.station || 'intake'))).sort()]
  }, [leads])

  const queue = useMemo(() => {
    const query = search.trim().toLowerCase()
    const attemptsFrom = parseNumberOrNull(optionalFilters.attemptsFrom)
    const attemptsTo = parseNumberOrNull(optionalFilters.attemptsTo)
    const createDateFromTs = parseDateLowerBound(optionalFilters.createDateFrom)
    const createDateToTs = parseDateUpperBound(optionalFilters.createDateTo)
    const statusFromTs = parseDateLowerBound(optionalFilters.statusChangeFrom)
    const statusToTs = parseDateUpperBound(optionalFilters.statusChangeTo)
    return leads
      .filter((lead) => {
        const leadProspects = prospectByLeadId.get(lead.id) ?? []
        const temp = calculateTemperature({ priority: lead.priority, station: lead.station, created_at: lead.created_at })
        const lastContact = lastContactByLeadId.get(lead.id)
        const staleDays = daysSince(lastContact)
        if (preset === 'scheduled_today') return scheduledTodayLeadIds.has(lead.id)
        if (preset === 'followups_today') return followupLeadIds.has(lead.id) || dateKey(lead.appointment_date) === today
        if (preset === 'stale_30') return staleDays == null || staleDays >= 30
        if (preset === 'warm_followups') return lead.priority === 'hot' || lead.priority === 'high' || (lead.motivation_score || 0) >= 5 || temp === 'hot' || temp === 'warm'
        if (preset === 'cold_prospecting') return ['new', 'intake', 'not_contacted', '', null].includes(lead.station as string | null) && !['hot', 'high'].includes(lead.priority || '')
        if (preset === 'tax_2yr') return leadProspects.some((prospect) => prospect.delinquent_years_category === '2yr')
        if (preset === 'deceased_3yr') return leadProspects.some((prospect) => prospect.is_deceased && ['2yr', '3yr_plus'].includes(prospect.delinquent_years_category || ''))
        if (preset === 'priority') return lead.priority === 'hot' || lead.priority === 'high' || (lead.motivation_score || 0) >= 7
        if (preset === 'next_step') return Boolean(lead.appointment_date)
        return true
      })
      .filter((lead) => campaign === 'all' || lead.source === campaign)
      .filter((lead) => statusFilter === 'all' || (lead.station || 'intake') === statusFilter)
      .filter((lead) => priorityFilter === 'all' || lead.priority === priorityFilter)
      .filter((lead) => (lead.motivation_score || 0) >= minMotivation)
      .filter((lead) => !query || queueLeadText(lead).includes(query))
      .filter((lead) => {
        const attempts = callAttemptCountByLeadId.get(lead.id) || 0
        if (attemptsFrom != null && attempts < attemptsFrom) return false
        if (attemptsTo != null && attempts > attemptsTo) return false

        const lastDialed = lastDialedByLeadId.get(lead.id)
        if (optionalFilters.notDialed === 'never' && lastDialed) return false
        if (optionalFilters.notDialed !== 'none' && optionalFilters.notDialed !== 'never') {
          const minDays = Number(optionalFilters.notDialed.replace('d', ''))
          if (Number.isFinite(minDays) && lastDialed) {
            const dialedDays = daysSince(lastDialed)
            if (dialedDays != null && dialedDays < minDays) return false
          }
        }

        if (optionalFilters.notContactedDays !== 'none') {
          const lastContact = lastContactByLeadId.get(lead.id)
          if (optionalFilters.notContactedDays === 'never') {
            // Keep only leads with no contact activity of any kind (call, SMS,
            // or voicemail) — true "never contacted".
            if (lastContact) return false
          } else {
            const minDays = Number(optionalFilters.notContactedDays)
            if (Number.isFinite(minDays) && lastContact) {
              const contactDays = daysSince(lastContact)
              if (contactDays != null && contactDays < minDays) return false
            }
          }
        }

        const createdAtTime = new Date(lead.created_at).getTime()
        if (createDateFromTs != null && Number.isFinite(createdAtTime) && createdAtTime < createDateFromTs) return false
        if (createDateToTs != null && Number.isFinite(createdAtTime) && createdAtTime > createDateToTs) return false

        const statusTime = new Date(lead.updated_at || lead.created_at).getTime()
        if (statusFromTs != null && Number.isFinite(statusTime) && statusTime < statusFromTs) return false
        if (statusToTs != null && Number.isFinite(statusTime) && statusTime > statusToTs) return false

        return true
      })
      .sort((a, b) => {
        const aDue = followupLeadIds.has(a.id) || scheduledTodayLeadIds.has(a.id) ? 1 : 0
        const bDue = followupLeadIds.has(b.id) || scheduledTodayLeadIds.has(b.id) ? 1 : 0
        const aScore = (a.motivation_score || 0) + (a.priority === 'hot' ? 4 : a.priority === 'high' ? 2 : 0)
        const bScore = (b.motivation_score || 0) + (b.priority === 'hot' ? 4 : b.priority === 'high' ? 2 : 0)
        const aUpdated = new Date(a.updated_at || a.created_at).getTime()
        const bUpdated = new Date(b.updated_at || b.created_at).getTime()
        const aContact = lastContactByLeadId.get(a.id)
        const bContact = lastContactByLeadId.get(b.id)
        const aContactTime = aContact ? new Date(aContact).getTime() : 0
        const bContactTime = bContact ? new Date(bContact).getTime() : 0

        if (optionalFilters.callOldestToNewest) return aUpdated - bUpdated || aScore - bScore
        if (sortBy === 'due_first') return bDue - aDue || bScore - aScore || bUpdated - aUpdated
        if (sortBy === 'oldest_contact') return aContactTime - bContactTime || bScore - aScore
        if (sortBy === 'newest') return bUpdated - aUpdated
        if (sortBy === 'oldest') return aUpdated - bUpdated
        if (sortBy === 'motivation') return (b.motivation_score || 0) - (a.motivation_score || 0) || bScore - aScore
        if (sortBy === 'name') return (a.full_name || '').localeCompare(b.full_name || '')
        if (aDue !== bDue) return bDue - aDue
        if (aScore !== bScore) return bScore - aScore
        return bUpdated - aUpdated
      })
  }, [campaign, callAttemptCountByLeadId, followupLeadIds, lastContactByLeadId, lastDialedByLeadId, leads, minMotivation, optionalFilters, preset, priorityFilter, prospectByLeadId, scheduledTodayLeadIds, search, sortBy, statusFilter, today])

  const selectedQueue = useMemo(() => {
    return queue.filter((lead) => selectedLeadIds.has(lead.id))
  }, [queue, selectedLeadIds])

  const selectedSavedQueue: SavedDialerQueue | null = activeSavedQueueId
    ? savedQueues.find((item) => item.id === activeSavedQueueId) ?? null
    : null
  const selectedPreset = QUEUE_PRESETS.find((item) => item.id === preset) ?? QUEUE_PRESETS[0]
  const callerPlan = useMemo(() => {
    return normalizeDialerCallerPlan({
      mode: callerMode,
      staticCallerId: callerId || DEFAULT_DIALER_CALLER_ID,
      rotationCallerIds,
      rotateEveryCalls,
      redialCallerId: redialCallerId || null,
    }, callerId || DEFAULT_DIALER_CALLER_ID)
  }, [callerMode, callerId, rotationCallerIds, rotateEveryCalls, redialCallerId])

  const buildSessionUrl = useCallback((
    ids: string[],
    startIndex: number,
    savedListId?: string,
    callerIdValue?: string,
    callerPlanInput?: Partial<DialerCallerPlan> | null,
    callHammerSettings?: { useCallHammer?: boolean; useVoicemailCallHammer?: boolean } | null,
    queueLabel?: string,
    ringCountValue?: number | null,
    sessionId?: string,
  ) => {
    const query = new URLSearchParams()
    query.set('lead_ids', ids.join(','))
    query.set('return_to', '/dialer')
    if (startIndex > 0) query.set('start_index', String(startIndex))
    if (savedListId) query.set('saved_list_id', savedListId)
    const callerPlan = normalizeDialerCallerPlan(callerPlanInput, callerIdValue || DEFAULT_DIALER_CALLER_ID)
    if (callerPlan.staticCallerId) query.set('caller_id', callerPlan.staticCallerId)
    query.set('caller_mode', callerPlan.mode)
    query.set('rotation_every', String(callerPlan.rotateEveryCalls || DEFAULT_ROTATION_EVERY_CALLS))
    if (callerPlan.rotationCallerIds.length > 0) query.set('rotation_numbers', callerPlan.rotationCallerIds.join(','))
    if (callerPlan.redialCallerId) query.set('redial_caller_id', callerPlan.redialCallerId)
    if (queueLabel) query.set('queue_label', queueLabel)
    query.set('call_hammer', callHammerSettings?.useCallHammer ? '1' : '0')
    query.set('voicemail_call_hammer', callHammerSettings?.useVoicemailCallHammer ? '1' : '0')
    if (ringCountValue && ringCountValue > 0) query.set('ring_count', String(ringCountValue))
    if (sessionId) query.set('session_id', sessionId)
    return `/dialer?${query.toString()}`
  }, [])

  const startQueue = useCallback(async () => {
    const source = selectedQueue.length > 0 ? selectedQueue : queue
    const sourceIds = source.slice(0, 100).map((lead) => lead.id)

    const canResumeFromSaved =
      startBehavior === 'resume' &&
      Boolean(selectedSavedQueue) &&
      (selectedSavedQueue?.sessionLeadIds || []).length > 0 &&
      !selectedSavedQueue?.sessionCompleted

    const ids = canResumeFromSaved
      ? (selectedSavedQueue?.sessionLeadIds || []).slice(0, 100)
      : sourceIds
    if (ids.length === 0) return

    const startIndex = canResumeFromSaved
      ? Math.min(
          Math.max(selectedSavedQueue?.resumeIndex || 0, 0),
          Math.max(ids.length - 1, 0),
        )
      : 0

    if (activeSavedQueueId) {
      patchSavedListMeta(activeSavedQueueId, {
        callerId: callerPlan.staticCallerId,
        callerMode: callerPlan.mode,
        rotationCallerIds: callerPlan.rotationCallerIds,
        rotateEveryCalls: callerPlan.rotateEveryCalls,
        redialCallerId: callerPlan.redialCallerId,
        startBehavior,
        optionalFilters,
        useCallHammer,
        useVoicemailCallHammer,
        sessionLeadIds: ids,
        resumeIndex: startIndex,
        resumeLeadId: ids[startIndex] || null,
        resumeUpdatedAt: new Date().toISOString(),
        sessionCompleted: false,
      })
      void fetch('/api/dialer/saved-lists', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: activeSavedQueueId,
          callerId: callerPlan.staticCallerId,
          useCallHammer,
          useVoicemailCallHammer,
          sessionLeadIds: ids,
          resumeIndex: startIndex,
          resumeLeadId: ids[startIndex] || null,
          sessionCompleted: false,
        }),
      })
    }

    try {
      const createdSession = await createDurableDialerSession({
        leadIds: ids,
        queueKey: selectedPreset.id,
        callerId: callerPlan.staticCallerId,
        savedQueueId: activeSavedQueueId || undefined,
        settings: {
          callerPlan,
          ringCount,
          queueLabel: selectedSavedQueue?.name || selectedPreset.label,
        },
      })
      const session = createdSession.session
      const navigationPlan = createdSession.created
        ? callerPlan
        : normalizeDialerCallerPlan({ mode: 'static', staticCallerId: session.callerId || callerPlan.staticCallerId }, session.callerId || callerPlan.staticCallerId)
      router.push(buildSessionUrl(
      session.leadIds,
      session.currentIndex,
      activeSavedQueueId || undefined,
      session.callerId || callerPlan.staticCallerId,
      navigationPlan,
      { useCallHammer, useVoicemailCallHammer },
      createdSession.created ? selectedSavedQueue?.name || selectedPreset.label : session.queueKey.replace(/_/g, ' '),
      ringCount,
      session.id,
      ))
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : 'Could not create the dialer session.')
    }
  }, [activeSavedQueueId, buildSessionUrl, callerPlan, optionalFilters, queue, ringCount, router, selectedPreset.id, selectedPreset.label, selectedQueue, selectedSavedQueue, startBehavior, useCallHammer, useVoicemailCallHammer])

  const resumeSavedQueue = useCallback(async (queueOverride?: SavedDialerQueue) => {
    const queueToResume = queueOverride ?? selectedSavedQueue
    if (!queueToResume) return
    const ids = (queueToResume.sessionLeadIds || []).slice(0, 100)
    if (ids.length === 0) return
    const resumePlan = normalizeDialerCallerPlan({
      mode: queueToResume.callerMode || callerMode,
      staticCallerId: queueToResume.callerId || callerId,
      rotationCallerIds: queueToResume.rotationCallerIds || rotationCallerIds,
      rotateEveryCalls: queueToResume.rotateEveryCalls || rotateEveryCalls,
      redialCallerId: queueToResume.redialCallerId || redialCallerId || null,
    }, queueToResume.callerId || callerId || DEFAULT_DIALER_CALLER_ID)
    patchSavedListMeta(queueToResume.id, {
      callerId: resumePlan.staticCallerId,
      callerMode: resumePlan.mode,
      rotationCallerIds: resumePlan.rotationCallerIds,
      rotateEveryCalls: resumePlan.rotateEveryCalls,
      redialCallerId: resumePlan.redialCallerId,
      useCallHammer: queueToResume.useCallHammer ?? useCallHammer,
      useVoicemailCallHammer: queueToResume.useVoicemailCallHammer ?? useVoicemailCallHammer,
    })
    try {
      const createdSession = await createDurableDialerSession({
        leadIds: ids,
        queueKey: queueToResume.preset,
        callerId: resumePlan.staticCallerId,
        savedQueueId: queueToResume.id,
        settings: { callerPlan: resumePlan, ringCount, queueLabel: queueToResume.name },
      })
      const session = createdSession.session
      const navigationPlan = createdSession.created
        ? resumePlan
        : normalizeDialerCallerPlan({ mode: 'static', staticCallerId: session.callerId || resumePlan.staticCallerId }, session.callerId || resumePlan.staticCallerId)
      router.push(buildSessionUrl(
        session.leadIds,
        session.currentIndex,
        queueToResume.id,
        session.callerId || resumePlan.staticCallerId,
        navigationPlan,
        {
          useCallHammer: queueToResume.useCallHammer ?? useCallHammer,
          useVoicemailCallHammer: queueToResume.useVoicemailCallHammer ?? useVoicemailCallHammer,
        },
        createdSession.created ? queueToResume.name : session.queueKey.replace(/_/g, ' '),
        ringCount,
        session.id,
      ))
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : 'Could not resume the dialer session.')
    }
  }, [buildSessionUrl, callerId, callerMode, redialCallerId, rotateEveryCalls, rotationCallerIds, ringCount, router, selectedSavedQueue, useCallHammer, useVoicemailCallHammer])

  const currentLead = selectedQueue[0] ?? queue[0] ?? null
  const previewLeads = queue.slice(0, visibleLimit)
  const selectedVisibleCount = previewLeads.filter((lead) => selectedLeadIds.has(lead.id)).length
  const selectedCount = selectedQueue.length
  const hasFilters = campaign !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all' || minMotivation > 0 || search.trim().length > 0
  const optionalFilterCount = [
    optionalFilters.attemptsFrom.trim().length > 0,
    optionalFilters.attemptsTo.trim().length > 0,
    optionalFilters.notDialed !== 'none',
    optionalFilters.notContactedDays !== 'none',
    optionalFilters.createDateFrom.trim().length > 0,
    optionalFilters.createDateTo.trim().length > 0,
    optionalFilters.statusChangeFrom.trim().length > 0,
    optionalFilters.statusChangeTo.trim().length > 0,
    optionalFilters.callOldestToNewest,
  ].filter(Boolean).length
  const activeFilterCount = [
    campaign !== 'all',
    statusFilter !== 'all',
    priorityFilter !== 'all',
    minMotivation > 0,
    search.trim().length > 0,
    optionalFilterCount > 0,
  ].filter(Boolean).length
  const resetFilters = useCallback(() => {
    setCampaign('all')
    setStatusFilter('all')
    setPriorityFilter('all')
    setMinMotivation(0)
    setSearch('')
    setOptionalFilters({ ...DEFAULT_OPTIONAL_FILTERS })
    setOptionalFiltersDraft({ ...DEFAULT_OPTIONAL_FILTERS })
    setSelectedLeadIds(new Set())
  }, [])
  const toggleLeadSelection = useCallback((leadId: string) => {
    setSelectedLeadIds((current) => {
      const next = new Set(current)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
  }, [])
  const selectVisibleLeads = useCallback(() => {
    setSelectedLeadIds((current) => {
      const next = new Set(current)
      previewLeads.forEach((lead) => next.add(lead.id))
      return next
    })
  }, [previewLeads])
  const clearSelectedLeads = useCallback(() => setSelectedLeadIds(new Set()), [])
  const applySavedQueue = useCallback((savedQueue: SavedDialerQueue) => {
    const callerPlan = normalizeDialerCallerPlan({
      mode: savedQueue.callerMode,
      staticCallerId: savedQueue.callerId || DEFAULT_DIALER_CALLER_ID,
      rotationCallerIds: savedQueue.rotationCallerIds || [],
      rotateEveryCalls: savedQueue.rotateEveryCalls || DEFAULT_ROTATION_EVERY_CALLS,
      redialCallerId: savedQueue.redialCallerId || null,
    }, savedQueue.callerId || DEFAULT_DIALER_CALLER_ID)
    setPreset(savedQueue.preset)
    setAgent(savedQueue.agent)
    setCallerId(callerPlan.staticCallerId || DEFAULT_DIALER_CALLER_ID)
    setCallerMode(callerPlan.mode)
    setRotationCallerIds(callerPlan.rotationCallerIds.length > 0 ? callerPlan.rotationCallerIds : (callerPlan.staticCallerId ? [callerPlan.staticCallerId] : []))
    setRotateEveryCalls(callerPlan.rotateEveryCalls || DEFAULT_ROTATION_EVERY_CALLS)
    setRedialCallerId(callerPlan.redialCallerId || '')
    setStartBehavior(savedQueue.startBehavior || 'resume')
    const savedOptionalFilters = normalizeOptionalFilters(savedQueue.optionalFilters || DEFAULT_OPTIONAL_FILTERS)
    setOptionalFilters(savedOptionalFilters)
    setOptionalFiltersDraft(savedOptionalFilters)
    setUseCallHammer(savedQueue.useCallHammer ?? true)
    setUseVoicemailCallHammer(savedQueue.useVoicemailCallHammer ?? false)
    setCampaign(savedQueue.campaign)
    setStatusFilter(savedQueue.statusFilter)
    setPriorityFilter(savedQueue.priorityFilter)
    setMinMotivation(savedQueue.minMotivation)
    setSearch(savedQueue.search)
    setSortBy(savedQueue.sortBy)
    setVisibleLimit(savedQueue.visibleLimit)
    setActiveSavedQueueId(savedQueue.id)
    setSavedQueueName(savedQueue.name)
    setSelectedLeadIds(new Set())
  }, [])
  const saveCurrentQueue = useCallback(async () => {
    const name = savedQueueName.trim() || selectedPreset.label
    const existingId = activeSavedQueueId && savedQueues.some((item) => item.id === activeSavedQueueId) ? activeSavedQueueId : undefined
    const response = await fetch('/api/dialer/saved-lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: existingId,
        agent,
        name,
        preset,
        callerId,
        callerMode,
        rotationCallerIds,
        rotateEveryCalls,
        redialCallerId: redialCallerId || null,
        startBehavior,
        optionalFilters,
        useCallHammer,
        useVoicemailCallHammer,
        campaign,
        statusFilter,
        priorityFilter,
        minMotivation,
        search,
        sortBy,
        visibleLimit,
      }),
    })
    const payload = await response.json()
    if (!response.ok) {
      setSavedQueueError(payload?.error || 'Could not save list.')
      return
    }
    const savedQueue = payload.savedList as SavedDialerQueue
    patchSavedListMeta(savedQueue.id, {
      callerId,
      callerMode,
      rotationCallerIds,
      rotateEveryCalls,
      redialCallerId: redialCallerId || null,
      startBehavior,
      optionalFilters,
      useCallHammer,
      useVoicemailCallHammer,
    })
    const mergedSavedQueue = mergeSavedQueueWithLocalMeta(savedQueue)
    setSavedQueues((current) => {
      const withoutCurrent = current.filter((item) => item.id !== mergedSavedQueue.id)
      return [mergedSavedQueue, ...withoutCurrent].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    })
    setActiveSavedQueueId(mergedSavedQueue.id)
    setSavedQueueName(mergedSavedQueue.name)
    setSavedQueueError(null)
  }, [activeSavedQueueId, agent, callerId, callerMode, campaign, minMotivation, optionalFilters, preset, priorityFilter, redialCallerId, rotateEveryCalls, rotationCallerIds, savedQueueName, savedQueues, search, selectedPreset.label, sortBy, startBehavior, statusFilter, useCallHammer, useVoicemailCallHammer, visibleLimit])
  const deleteSavedQueue = useCallback(async () => {
    if (!activeSavedQueueId) return
    const response = await fetch(`/api/dialer/saved-lists?id=${encodeURIComponent(activeSavedQueueId)}`, { method: 'DELETE' })
    const payload = await response.json()
    if (!response.ok) {
      setSavedQueueError(payload?.error || 'Could not delete list.')
      return
    }
    const meta = readSavedListMeta()
    if (meta[activeSavedQueueId]) {
      delete meta[activeSavedQueueId]
      writeSavedListMeta(meta)
    }
    setSavedQueues((current) => current.filter((item) => item.id !== activeSavedQueueId))
    setActiveSavedQueueId('')
    setSavedQueueName('')
    setSavedQueueError(null)
  }, [activeSavedQueueId])
  const resumeLeadIds = selectedSavedQueue?.sessionLeadIds || []
  const hasResumePoint = Boolean(
    selectedSavedQueue &&
    resumeLeadIds.length > 0 &&
    !selectedSavedQueue.sessionCompleted &&
    selectedSavedQueue.resumeIndex >= 0 &&
    selectedSavedQueue.resumeIndex < resumeLeadIds.length,
  )
  const resumeRemaining = hasResumePoint
    ? resumeLeadIds.length - (selectedSavedQueue?.resumeIndex || 0)
    : 0
  const rotationSummary = callerPlan.rotationCallerIds.map((num, idx) => `${formatPhone(num)} (Group ${String.fromCharCode(65 + (idx % 26))})`).join(', ')
  const hasRotation = callerMode === 'rotation' && callerPlan.rotationCallerIds.length > 0
  const canStart = queue.length > 0 && callingWindowOpen
  const scheduledCount = leads.filter((lead) => scheduledTodayLeadIds.has(lead.id)).length
  const followupCount = leads.filter((lead) => followupLeadIds.has(lead.id) || dateKey(lead.appointment_date) === today).length
  const priorityCount = leads.filter((lead) => lead.priority === 'hot' || lead.priority === 'high' || (lead.motivation_score || 0) >= 7).length
  const staleCount = leads.filter((lead) => {
    const staleDays = daysSince(lastContactByLeadId.get(lead.id))
    return staleDays == null || staleDays >= 30
  }).length
  const callsToday = contactActivities.filter((activity) => ['call', 'voicemail'].includes(activity.activity_type) && dateKey(activity.created_at) === today).length
  const uniqueLeadsToday = new Set(contactActivities.filter((activity) => ['call', 'voicemail'].includes(activity.activity_type) && dateKey(activity.created_at) === today).map((activity) => activity.lead_id).filter(Boolean)).size
  const activeSessions = savedQueues.filter((savedQueue) => savedQueue.sessionLeadIds.length > 0 && !savedQueue.sessionCompleted)

  const openQueue = useCallback((nextPreset: QueuePreset) => {
    setPreset(nextPreset)
    setSelectedLeadIds(new Set())
    router.push('/dialer?section=queue')
  }, [router])

  const openOptionalFilterModal = useCallback(() => {
    setOptionalFiltersDraft({ ...optionalFilters })
    setShowOptionalFilters(true)
  }, [optionalFilters])

  const clearOptionalFilterDraft = useCallback(() => {
    setOptionalFiltersDraft({ ...DEFAULT_OPTIONAL_FILTERS })
  }, [])

  const applyOptionalFilterDraft = useCallback(() => {
    setOptionalFilters(normalizeOptionalFilters(optionalFiltersDraft))
    setShowOptionalFilters(false)
    setSelectedLeadIds(new Set())
  }, [optionalFiltersDraft])

  const toggleRotationCallerId = useCallback((value: string) => {
    setRotationCallerIds((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value)
        return next.length > 0 ? next : [callerId || value]
      }
      return [...current, value]
    })
  }, [callerId])

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 pb-20 sm:px-6 lg:px-8">
      {showBulkSms ? <BulkSmsModal
        open={showBulkSms}
        onClose={() => setShowBulkSms(false)}
        leadIds={(selectedCount > 0 ? selectedQueue : queue).map((lead) => lead.id)}
        agent={agent}
        fromPhone={callerId}
      /> : null}
      {homeSection === 'queue' && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--crm-brand)]">Dialer queue builder</p>
            <h1 className="text-3xl font-black tracking-tight text-[var(--ck-text)]">Prepare a calling session</h1>
            <p className="mt-1 text-sm text-[var(--ck-text-muted)]">Choose who to call, review the order, then launch with the right number and method.</p>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3.5 py-1.5 text-sm font-bold text-[var(--ck-text)] sm:self-auto">
            <span className={`h-2 w-2 rounded-full ${loading ? 'bg-[var(--ck-text-dim)]' : queue.length ? 'bg-[var(--crm-success)]' : 'bg-[var(--crm-danger)]'}`} />
            {loading ? 'Loading queue…' : selectedCount > 0 ? `${selectedCount.toLocaleString()} selected` : `${queue.length.toLocaleString()} contacts ready`}
          </div>
        </div>
      )}

      {homeSection === 'overview' ? (
        <DialerOverview
          loading={loading}
          readyCount={leads.length}
          scheduledCount={scheduledCount}
          followupCount={followupCount}
          priorityCount={priorityCount}
          staleCount={staleCount}
          callsToday={callsToday}
          uniqueLeadsToday={uniqueLeadsToday}
          activeSessions={activeSessions}
          focusLeads={queue}
          onOpenQueue={openQueue}
          onResume={resumeSavedQueue}
          lastContactByLeadId={lastContactByLeadId}
        />
      ) : homeSection === 'sessions' ? (
        <DialerSessionsView savedQueues={savedQueues} onResume={resumeSavedQueue} onOpenQueue={openQueue} />
      ) : homeSection === 'analytics' ? (
        <DialerAnalyticsView callsToday={callsToday} uniqueLeadsToday={uniqueLeadsToday} followupCount={followupCount} readyCount={leads.length} contactActivities={contactActivities} />
      ) : homeSection === 'settings' ? (
        <DialerSettingsView callerId={callerId} setCallerId={setCallerId} ringCount={ringCount} setRingCount={setRingCount} />
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-danger-soft)] p-4 text-sm text-[var(--crm-danger)]">
              {error}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
            {/* ── WHO: pick the queue, refine, preview ── */}
            <main className="space-y-5">
          <section className="ck-card p-5">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]">1</span>
              Choose the queue
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Calling Queue</span>
                <select
                  value={preset}
                  onChange={(event) => {
                    setPreset(event.target.value as QueuePreset)
                    setSelectedLeadIds(new Set())
                  }}
                  className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-3 text-base font-bold text-[var(--ck-text)] outline-none focus:border-[var(--crm-focus)]"
                >
                  {QUEUE_PRESETS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => setShowBulkSms(true)}
                disabled={queue.length === 0}
                title={selectedCount > 0 ? `Text ${selectedCount} selected leads` : 'Text the leads in this queue'}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-4 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--crm-brand-border)] hover:bg-[var(--crm-brand-soft)] hover:text-[var(--crm-brand)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Icon name="forum" size="text-lg" /> Text
              </button>
            </div>
            <p className="mt-3 text-sm text-[var(--ck-text-muted)]">{selectedPreset.description}</p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowQueueControls((value) => !value)}
                aria-expanded={showQueueControls}
                className="flex items-center justify-between rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]"
              >
                <span>Refine{activeFilterCount > 0 && <span className="ml-1.5 text-[var(--crm-brand)]">{activeFilterCount}</span>}</span>
                <Icon name={showQueueControls ? 'expand_less' : 'expand_more'} size="text-lg" />
              </button>
              <button
                onClick={() => setShowSavedLists((value) => !value)}
                aria-expanded={showSavedLists}
                className="flex items-center justify-between rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]"
              >
                <span>Saved lists{selectedSavedQueue ? <span className="ml-1.5 text-[var(--crm-brand)]">●</span> : null}</span>
                <Icon name={showSavedLists ? 'expand_less' : 'expand_more'} size="text-lg" />
              </button>
            </div>

            {showQueueControls && (
              <div className="mt-3 border-t border-[var(--ck-border)] pt-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <DarkSelect label="Campaign" value={campaign} onChange={(value) => { setCampaign(value); setSelectedLeadIds(new Set()) }} options={sourceOptions} />
                  <DarkSelect label="Status" value={statusFilter} onChange={(value) => { setStatusFilter(value); setSelectedLeadIds(new Set()) }} options={statusOptions} />
                  <DarkSelect label="Priority" value={priorityFilter} onChange={(value) => { setPriorityFilter(value); setSelectedLeadIds(new Set()) }} options={['all', 'hot', 'high', 'normal']} />
                  <DarkSelect label="Sort" value={sortBy} onChange={(value) => setSortBy(value as QueueSort)} options={QUEUE_SORTS.map((item) => item.id)} />
                  <DarkSelect label="Show" value={String(visibleLimit)} onChange={(value) => setVisibleLimit(Number(value))} options={['25', '50', '100']} />
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Motivation {minMotivation}+</span>
                    <input type="range" min="0" max="10" value={minMotivation} onChange={(e) => { setMinMotivation(Number(e.target.value)); setSelectedLeadIds(new Set()) }} className="mt-3 w-full accent-[var(--crm-brand)]" />
                  </label>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Icon name="search" size="text-lg" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]" />
                    <input
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value)
                        setSelectedLeadIds(new Set())
                      }}
                      placeholder="Search name, phone, address, source"
                      className="w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] py-2.5 pl-10 pr-3 text-sm text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                    />
                  </div>
                  {hasFilters && (
                    <button onClick={resetFilters} className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]">
                      Clear filters
                    </button>
                  )}
                  <button onClick={openOptionalFilterModal} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[#E32E2E]/50 hover:text-[var(--ck-text)]">
                    <Icon name="tune" size="text-base" /> More filters{optionalFilterCount > 0 ? ` (${optionalFilterCount})` : ''}
                  </button>
                </div>
              </div>
            )}

            {showSavedLists && (
              <div className="mt-3 border-t border-[var(--ck-border)] pt-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_88px_72px] md:items-end">
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Saved List</span>
                    <select
                      value={activeSavedQueueId}
                      onChange={(event) => {
                        const savedQueue = savedQueues.find((item) => item.id === event.target.value)
                        if (savedQueue) applySavedQueue(savedQueue)
                        else {
                          setActiveSavedQueueId('')
                          setSavedQueueName('')
                        }
                      }}
                      className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                    >
                      <option value="">Select list</option>
                      {savedQueues.map((savedQueue) => (
                        <option key={savedQueue.id} value={savedQueue.id}>{savedQueue.name} ({savedQueue.agent})</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">List Name</span>
                    <input
                      value={savedQueueName}
                      onChange={(event) => setSavedQueueName(event.target.value)}
                      placeholder={selectedPreset.label}
                      className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                    />
                  </label>
                  <button
                    onClick={saveCurrentQueue}
                    className="rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-2 text-xs font-black uppercase tracking-wider text-[var(--crm-brand)] transition-colors hover:border-[var(--crm-brand)]"
                  >
                    Save
                  </button>
                  <button
                    onClick={deleteSavedQueue}
                    disabled={!activeSavedQueueId}
                    className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Delete
                  </button>
                </div>
                {savedQueueError && (
                  <p className="mt-3 text-xs font-bold text-[var(--crm-danger)]">{savedQueueError}</p>
                )}
                {selectedSavedQueue && !savedQueueError && (
                  <p className="mt-3 text-xs text-[var(--ck-text-muted)]">
                    Loaded for {selectedSavedQueue.agent}. Updated {formatActivityTime(selectedSavedQueue.updatedAt)}.
                    {selectedSavedQueue.callerId ? ` Calling from ${formatPhone(selectedSavedQueue.callerId)}.` : ''}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="ck-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--ck-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-[var(--ck-text)]">Review the call order</p>
                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Showing {previewLeads.length} contacts. Select only the people this session should call.</p>
              </div>
              <div className="flex items-center gap-3 text-xs font-bold text-[var(--ck-text-muted)]">
                <span>{selectedVisibleCount}/{previewLeads.length} shown · {selectedCount.toLocaleString()} selected</span>
                <button onClick={selectVisibleLeads} disabled={previewLeads.length === 0} className="transition-colors hover:text-[var(--ck-text)] disabled:opacity-35">Select shown</button>
                {selectedCount > 0 && (
                  <button onClick={clearSelectedLeads} className="transition-colors hover:text-[var(--ck-text)]">Clear</button>
                )}
              </div>
            </div>
            <div className="max-h-[620px] overflow-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-[var(--ck-text-muted)]">Loading queue...</div>
            ) : queue.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-bold text-[var(--ck-text)]">No callable leads match this queue.</p>
                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Change the preset, campaign, status, score, or search filter.</p>
              </div>
            ) : (
              previewLeads.map((lead, index) => (
                <div key={lead.id} className="grid gap-3 border-b border-[var(--ck-border)] px-5 py-4 transition-colors hover:bg-[var(--crm-surface-subtle)] md:grid-cols-[28px_34px_minmax(0,1fr)_145px_88px] md:items-center">
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.has(lead.id)}
                    onChange={() => toggleLeadSelection(lead.id)}
                    aria-label={`Select ${lead.full_name || 'lead'}`}
                    className="h-4 w-4 rounded border-[var(--ck-border)] bg-[var(--ck-surface-elev)] accent-[var(--crm-brand)]"
                  />
                  <div className="text-xs font-black text-[var(--ck-text-dim)]">{index + 1}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-black text-[var(--ck-text)]">{toProperCase(lead.full_name) || 'Unknown Lead'}</p>
                      {scheduledTodayLeadIds.has(lead.id) && <DarkPill tone="red">today</DarkPill>}
                      {followupLeadIds.has(lead.id) && <DarkPill tone="red">due</DarkPill>}
                      {lead.priority && <DarkPill>{lead.priority}</DarkPill>}
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">{lead.property_address || lead.city || 'No property address'}</p>
                    <p className="mt-1 truncate text-xs text-[var(--ck-text-dim)]">
                      {lead.source || 'uncategorized'} / {lead.station || 'intake'} / last contact {lastContactLabel(lastContactByLeadId.get(lead.id))}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-[var(--ck-text)] font-mono">{formatPhone(lead.phone || '')}</p>
                  <button
                    onClick={() => router.push(buildSessionUrl(
                      [lead.id],
                      0,
                      activeSavedQueueId || undefined,
                      callerPlan.staticCallerId,
                      callerPlan,
                      { useCallHammer, useVoicemailCallHammer },
                      undefined,
                      ringCount,
                    ))}
                    className="inline-flex items-center justify-center rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[#E32E2E]/50"
                  >
                    Open
                  </button>
                </div>
              ))
            )}
            </div>
          </section>
        </main>

        {/* ── FROM · HOW · GO ── */}
        <aside className="lg:sticky lg:top-5">
          <section className="ck-card border-[var(--crm-brand-border)] p-5 shadow-[var(--crm-shadow-md)]">
            <div className="flex items-end justify-between gap-4 border-b border-[var(--ck-border)] pb-4">
              <div>
                <p className="text-3xl font-black leading-none tracking-tight text-[var(--ck-text)]">{loading ? '…' : (selectedCount || queue.length).toLocaleString()}</p>
                <p className="mt-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{selectedCount > 0 ? 'selected to call' : 'ready to call'}</p>
              </div>
              <p className="max-w-[150px] truncate text-right text-xs font-semibold text-[var(--ck-text-muted)]">{selectedPreset.label}</p>
            </div>

            <div className="mt-5">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]">2</span>
                Choose the calling number
              </div>
              <select
                value={callerId}
                onChange={(event) => {
                  const value = event.target.value
                  setCallerId(value)
                  if (!rotationCallerIds.includes(value) && callerMode === 'rotation') {
                    setRotationCallerIds((current) => Array.from(new Set([...current, value])))
                  }
                  if (activeSavedQueueId) patchSavedListMeta(activeSavedQueueId, { callerId: value })
                }}
                className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-sm font-bold text-[var(--ck-text)] outline-none focus:border-[var(--crm-focus)]"
              >
                {TWILIO_NUMBERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                onClick={() => setShowAdvancedNumbers((value) => !value)}
                aria-expanded={showAdvancedNumbers}
                className="mt-2 flex w-full items-center justify-between px-1 text-left text-[11px] font-semibold text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text)]"
              >
                <span>Advanced numbers{callerMode === 'rotation' ? ' · rotation on' : ''}</span>
                <Icon name={showAdvancedNumbers ? 'expand_less' : 'expand_more'} size="text-base" />
              </button>
              {showAdvancedNumbers && (
                <div className="mt-2 space-y-3 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-1">
                    <button
                      onClick={() => setCallerMode('static')}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${callerMode === 'static' ? 'bg-[var(--crm-surface)] text-[var(--crm-ink)] shadow-sm' : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'}`}
                    >
                      Static
                    </button>
                    <button
                      onClick={() => setCallerMode('rotation')}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${callerMode === 'rotation' ? 'bg-[var(--crm-surface)] text-[var(--crm-ink)] shadow-sm' : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'}`}
                    >
                      Rotation
                    </button>
                  </div>
                  {hasRotation && (
                    <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[var(--ck-text-muted)]">Rotate every <strong className="text-[var(--ck-text)]">{rotateEveryCalls}</strong> calls</span>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={rotateEveryCalls}
                          onChange={(event) => setRotateEveryCalls(Math.max(1, Number(event.target.value) || 1))}
                          className="w-16 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2 py-1 text-right text-xs font-semibold text-[var(--ck-text)]"
                        />
                      </div>
                      <div className="mt-2 max-h-28 space-y-1.5 overflow-auto pr-1">
                        {TWILIO_NUMBERS.map((option) => {
                          const checked = rotationCallerIds.includes(option.value)
                          return (
                            <label key={option.value} className="flex items-center gap-2 text-xs text-[var(--ck-text-muted)]">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleRotationCallerId(option.value)}
                                className="h-3.5 w-3.5 accent-[var(--crm-brand)]"
                              />
                              <span className={checked ? 'text-[var(--ck-text)]' : ''}>{option.label}</span>
                            </label>
                          )
                        })}
                      </div>
                      <p className="mt-2 text-[10px] text-[var(--ck-text-dim)]">{rotationSummary || 'Select at least one number for rotation.'}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]">3</span>
                Review the calling session
              </div>
              <div className="mt-2 flex items-start gap-3 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="call" size="text-lg" /></span>
                <div>
                  <p className="text-sm font-black text-[var(--ck-text)]">Single-line dialing</p>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--ck-text-muted)]">One number at a time. Save an outcome to move to the next callable number.</p>
                </div>
              </div>

              <div className="mt-3 space-y-1.5 text-xs text-[var(--ck-text-muted)]">
                <label className="flex items-start gap-2">
                  <input type="radio" name="startBehavior" checked={startBehavior === 'resume'} onChange={() => setStartBehavior('resume')} className="mt-0.5 h-3.5 w-3.5 accent-[var(--crm-brand)]" />
                  <span>Resume where I left off (new leads first)</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="startBehavior" checked={startBehavior === 'top'} onChange={() => setStartBehavior('top')} className="mt-0.5 h-3.5 w-3.5 accent-[var(--crm-brand)]" />
                  <span>Call top to bottom</span>
                </label>
              </div>

              <button
                onClick={() => setShowWizardAdvanced((current) => !current)}
                aria-expanded={showWizardAdvanced}
                className="mt-3 flex w-full items-center justify-between px-1 text-left text-[11px] font-semibold text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text)]"
              >
                <span>Call timing · {ringCount} rings</span>
                <Icon name={showWizardAdvanced ? 'expand_less' : 'expand_more'} size="text-base" />
              </button>
              {showWizardAdvanced && (
                <div className="mt-2 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Rings before no answer</span>
                    <select
                      value={String(ringCount)}
                      onChange={(event) => setRingCount(Math.max(1, Number(event.target.value) || 6))}
                      className="mt-1.5 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)]"
                    >
                      {['3', '4', '5', '6', '7', '8'].map((value) => (
                        <option key={value} value={value}>{value} rings</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>

            <div className="mt-5 border-t border-[var(--ck-border)] pt-4">
              {!callingWindowOpen && (
                <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-200">
                  Prospecting calls are paused outside Monday-Saturday, 9:00 AM-7:00 PM Central.
                </div>
              )}
              <button
                onClick={() => startQueue()}
                disabled={!canStart}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--crm-brand)] px-4 py-3.5 text-sm font-black text-white shadow-sm transition-colors hover:bg-[var(--crm-brand-hover)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Icon name="call" size="text-base" />
                Start single-line session{selectedCount > 0 ? ` · ${selectedCount}` : ''}
              </button>

              {hasResumePoint && (
                <button
                  onClick={() => resumeSavedQueue()}
                  disabled={!callingWindowOpen}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-4 py-2.5 text-xs font-black text-[var(--crm-brand)] transition-colors hover:border-[var(--crm-brand)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="history" size="text-base" /> Resume {(selectedSavedQueue?.resumeIndex || 0) + 1}/{resumeLeadIds.length} · {resumeRemaining} left
                </button>
              )}

              <button
                onClick={saveCurrentQueue}
                className="mt-2 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-xs font-semibold text-[var(--ck-text-muted)] transition-colors hover:border-[#E32E2E]/50 hover:text-[var(--ck-text)]"
              >
                Save as list
              </button>
            </div>

            <div className="mt-4 border-t border-[var(--ck-border)] pt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">First contact</p>
              {currentLead ? (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight text-[var(--ck-text)]">{toProperCase(currentLead.full_name) || 'Unknown Lead'}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--crm-brand)]">{formatPhone(currentLead.phone || '')}</p>
                  </div>
                  <button
                    onClick={() => router.push(buildSessionUrl(
                      [currentLead.id],
                      0,
                      activeSavedQueueId || undefined,
                      callerPlan.staticCallerId,
                      callerPlan,
                      { useCallHammer, useVoicemailCallHammer },
                      undefined,
                      ringCount,
                    ))}
                    className="shrink-0 rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-semibold text-[var(--ck-text-muted)] transition-colors hover:border-[#E32E2E]/50 hover:text-[var(--ck-text)]"
                  >
                    Open
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-[var(--ck-text-muted)]">Select a queue with callable leads.</p>
              )}
            </div>
          </section>
            </aside>
          </div>
        </>
      )}

      {homeSection === 'queue' && showOptionalFilters && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close optional dialing filters"
            onClick={() => setShowOptionalFilters(false)}
            className="absolute inset-0 bg-black/55 backdrop-blur-[6px]"
          />
          <div className="relative z-[1] w-full max-w-[640px] rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--crm-border)] px-5 py-4">
              <div>
                <h3 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--crm-ink)]">Advanced Filters</h3>
                <p className="mt-0.5 text-xs text-[var(--crm-text-muted)]">Refine who&apos;s in this list — applies to both calling and texting.</p>
              </div>
              <button
                onClick={() => setShowOptionalFilters(false)}
                className="h-9 w-9 rounded-lg border border-[var(--crm-border)] text-[var(--crm-text-muted)] transition-colors hover:bg-[var(--crm-surface-subtle)] hover:text-[var(--crm-ink)]"
              >
                <Icon name="close" size="text-lg" />
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">Stop Call Attempts</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    value={optionalFiltersDraft.attemptsFrom}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, attemptsFrom: event.target.value }))}
                    placeholder="From"
                    className="w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-medium text-[var(--crm-ink)] outline-none focus:border-[var(--crm-focus)]"
                  />
                  <input
                    type="number"
                    min={0}
                    value={optionalFiltersDraft.attemptsTo}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, attemptsTo: event.target.value }))}
                    placeholder="To"
                    className="w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-medium text-[var(--crm-ink)] outline-none focus:border-[var(--crm-focus)]"
                  />
                </div>
              </label>

              <DarkSelectLight
                label="Not Dialed"
                value={optionalFiltersDraft.notDialed}
                onChange={(value) => setOptionalFiltersDraft((current) => ({ ...current, notDialed: value as OptionalDialingFilters['notDialed'] }))}
                options={[
                  { value: 'none', label: '-- None --' },
                  { value: 'never', label: 'Never Dialed' },
                  { value: '7d', label: '7 Days' },
                  { value: '14d', label: '14 Days' },
                  { value: '30d', label: '30 Days' },
                ]}
              />

              <DarkSelectLight
                label="Not Contacted"
                value={optionalFiltersDraft.notContactedDays}
                onChange={(value) => setOptionalFiltersDraft((current) => ({ ...current, notContactedDays: value as OptionalDialingFilters['notContactedDays'] }))}
                options={[
                  { value: 'none', label: '-- None --' },
                  { value: 'never', label: 'Never (any channel)' },
                  { value: '1', label: '1 Day' },
                  { value: '3', label: '3 Days' },
                  { value: '7', label: '7 Days' },
                  { value: '14', label: '14 Days' },
                  { value: '30', label: '30 Days' },
                ]}
              />

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">Create Date</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={optionalFiltersDraft.createDateFrom}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, createDateFrom: event.target.value }))}
                    className="w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-medium text-[var(--crm-ink)] outline-none focus:border-[var(--crm-focus)]"
                  />
                  <input
                    type="date"
                    value={optionalFiltersDraft.createDateTo}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, createDateTo: event.target.value }))}
                    className="w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-medium text-[var(--crm-ink)] outline-none focus:border-[var(--crm-focus)]"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">Status Change</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={optionalFiltersDraft.statusChangeFrom}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, statusChangeFrom: event.target.value }))}
                    className="w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-medium text-[var(--crm-ink)] outline-none focus:border-[var(--crm-focus)]"
                  />
                  <input
                    type="date"
                    value={optionalFiltersDraft.statusChangeTo}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, statusChangeTo: event.target.value }))}
                    className="w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-medium text-[var(--crm-ink)] outline-none focus:border-[var(--crm-focus)]"
                  />
                </div>
              </label>
            </div>

            <div className="px-5 pb-2">
              <label className="inline-flex items-center gap-2 text-sm text-[var(--crm-text)]">
                <input
                  type="checkbox"
                  checked={optionalFiltersDraft.callOldestToNewest}
                  onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, callOldestToNewest: event.target.checked }))}
                  className="h-4 w-4 accent-[var(--crm-brand)]"
                />
                Call oldest to newest
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3 border-t border-[var(--crm-border)] px-5 py-4">
              <button
                onClick={() => setShowOptionalFilters(false)}
                className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-semibold text-[var(--crm-text)] transition-colors hover:bg-[var(--crm-surface-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={clearOptionalFilterDraft}
                className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-semibold text-[var(--crm-text)] transition-colors hover:bg-[var(--crm-surface-hover)]"
              >
                Clear
              </button>
              <button
                onClick={applyOptionalFilterDraft}
                className="rounded-lg bg-[var(--crm-brand)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--crm-brand-hover)]"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DarkSelectLight({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-sm font-medium text-[var(--crm-ink)] outline-none focus:border-[var(--crm-focus)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function DarkSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[var(--crm-focus)]"
      >
        {options.map((option) => (
          <option key={option} value={option}>{formatSelectOption(option)}</option>
        ))}
      </select>
    </label>
  )
}

function DarkPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'red' }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${tone === 'red' ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'bg-[var(--crm-surface-subtle)] text-[var(--ck-text-muted)]'}`}>
      {children}
    </span>
  )
}

export default function DialerPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] flex items-center justify-center"><Icon name="progress_activity" className="!text-4xl text-[var(--ck-text-dim)] animate-spin" /></div>}>
      <DialerPageInner />
    </Suspense>
  )
}
