'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { HeirsSection } from '@/components/leads/heirs-section'
import { SmsComposeModal } from '@/components/leads/sms-compose-modal'
import { CommsTimeline, CommsSummaryBar } from '@/components/leads/comms-timeline'
import { buildCommsTimeline, summarizeComms } from '@/lib/comms-timeline'
import { BulkSmsModal } from '@/components/leads/bulk-sms-modal'
import { createClient } from '@/lib/supabase/client'
import { calculateTemperature } from '@/lib/lead-temperature'
import { toProperCase, formatPhone } from '@/lib/format'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { CallerIdMode, DialerCallerPlan, normalizeDialerCallerPlan, parseCallerIdsCsv } from '@/lib/dialer-caller-plan'
import { DEAD_REASONS } from '@/lib/dialer-dispositions'

// URL contract:
//   /dialer?lead_ids=<uuid>,<uuid>,...
//   /dialer?cohort=deceased-2-3yr   (shorthand; resolves to lead_ids client-side)

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

interface ManifestShape {
  owner?: { coOwners?: string[] }
  property?: { vacant?: boolean }
}

interface Activity {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
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
}

interface OptionalDialingFilters {
  attemptsFrom: string
  attemptsTo: string
  notDialed: 'none' | 'never' | '7d' | '14d' | '30d'
  notContactedDays: 'none' | '1' | '3' | '7' | '14' | '30'
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
  { id: 'warm_followups', label: 'Warm Follow-ups', icon: 'local_fire_department', description: 'Hot, high-priority, qualified, and motivated sellers.' },
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
    notContactedDays: value?.notContactedDays === '1' || value?.notContactedDays === '3' || value?.notContactedDays === '7' || value?.notContactedDays === '14' || value?.notContactedDays === '30'
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
  const [leftTab, setLeftTab] = useState<'activity' | 'recent_calls'>('activity')

  // Live queue state from telephony-bar
  const [queueState, setQueueState] = useState<QueueState | null>(null)
  const [autoQueueLeadId, setAutoQueueLeadId] = useState<string | null>(null)

  // SMS compose state
  const [smsTarget, setSmsTarget] = useState<{ heirName: string; relation: string; phone: string } | null>(null)

  // Session tally (Mojo-style HUD) + mark-lead-dead dialog
  const [sessionDials, setSessionDials] = useState(0)
  const [sessionContacts, setSessionContacts] = useState(0)
  const [showMarkDead, setShowMarkDead] = useState(false)
  const [markDeadReason, setMarkDeadReason] = useState('')
  const [markDeadBusy, setMarkDeadBusy] = useState(false)
  const [markDeadError, setMarkDeadError] = useState<string | null>(null)

  const currentLeadId: string | null = leadIds[currentIndex] ?? null
  const currentLead: LeadSummary | null = currentLeadId ? leads[currentLeadId] ?? null : null
  const currentProspect: ProspectSummary | null = currentLeadId ? prospects[currentLeadId] ?? null : null
  const currentManifest: ManifestShape | null = currentLeadId ? manifests[currentLeadId] ?? null : null
  const sessionSavedListId = params.get('saved_list_id')?.trim() || ''
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
  }, [params])

  useEffect(() => {
    if (leadIds.length === 0) return
    const requested = Number(startIndexParam ?? '0')
    const safeIndex = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0
    const timeout = window.setTimeout(() => {
      setCurrentIndex(Math.min(safeIndex, Math.max(leadIds.length - 1, 0)))
      // Resume pointer is now applied — persistence may begin.
      setResumeHydrated(true)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [leadIds.length, startIndexParam])

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
    const supabase = createClient()
    async function load() {
      const [{ data: mRow }, { data: aRows }] = await Promise.all([
        supabase.from('manifests').select('manifest').eq('lead_id', currentLeadId).limit(1).maybeSingle(),
        supabase.from('lead_activities').select('id, activity_type, description, agent, metadata, created_at')
          .eq('lead_id', currentLeadId).order('created_at', { ascending: false }).limit(50),
      ])
      setManifests((prev) => ({ ...prev, [currentLeadId!]: (mRow as { manifest: ManifestShape } | null)?.manifest ?? null }))
      setActivities((aRows as Activity[] | null) ?? [])
    }
    load()
  }, [currentLeadId])

  const refreshActivities = useCallback(async () => {
    if (!currentLeadId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('lead_activities')
      .select('id, activity_type, description, agent, metadata, created_at')
      .eq('lead_id', currentLeadId)
      .order('created_at', { ascending: false })
      .limit(50)
    setActivities((data as Activity[] | null) ?? [])
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
    async function loadRecentCalls() {
      try {
        const res = await fetch('/api/call-log?limit=50')
        const data = await res.json()
        if (res.ok) setRecentCalls((data.calls as RecentCall[]) || [])
      } catch {}
    }
    loadRecentCalls()
  }, [])

  useEffect(() => {
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
  }, [sessionSavedListId, leadIds, currentIndex, sessionCallerId, resumeHydrated])

  // Listen to queue-state events from the telephony bar
  useEffect(() => {
    function onState(e: Event) {
      setQueueState((e as CustomEvent).detail as QueueState)
    }
    window.addEventListener('heir-queue-state', onState)
    return () => window.removeEventListener('heir-queue-state', onState)
  }, [])

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

  const handleAutoStartEmpty = useCallback(() => {
    if (currentIndex >= leadIds.length - 1) {
      setAutoQueueLeadId(null)
      return
    }
    window.setTimeout(() => advance(true), 200)
  }, [advance, currentIndex, leadIds.length])

  const closeSession = useCallback(() => {
    if (sessionSavedListId && leadIds.length > 0) {
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

    const returnTo = params.get('return_to')
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
      router.push(returnTo)
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/dialer')
  }, [currentIndex, leadIds, params, router, sessionCallerId, sessionSavedListId])

  useEffect(() => {
    function onQueueComplete(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.leadId === currentLeadId) {
        setTimeout(() => advance(true), 400)
      }
    }
    window.addEventListener('heir-queue-complete', onQueueComplete)
    return () => window.removeEventListener('heir-queue-complete', onQueueComplete)
  }, [currentLeadId, advance])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); advance() }
      if (e.key === 'k' || e.key === 'ArrowLeft')  { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, back])

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
          activity: {
            type: 'status_change',
            disposition: 'dead',
            notes: `Marked dead from dialer — ${markDeadReason.replace(/_/g, ' ')}`,
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
      refreshActivities()
      advance(true)
    } catch (e) {
      setMarkDeadError(e instanceof Error ? e.message : 'Could not mark lead dead')
    } finally {
      setMarkDeadBusy(false)
    }
  }, [currentLeadId, markDeadReason, advance, refreshActivities])

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

  const isCallingNow = queueState?.queueItem && ['calling', 'on_call'].includes(queueState.status)
  const inferredQueueLabel = sessionQueueLabelParam ||
    (params.get('cohort') === 'deceased-2-3yr'
      ? '3+ Year Deceased Tax'
      : delinquentYears
      ? `${delinquentYears} deceased tax list`
      : 'Dialer queue')
  const commsEvents = useMemo(() => buildCommsTimeline(activities), [activities])
  const commsSummary = useMemo(() => summarizeComms(commsEvents), [commsEvents])

  const dialTimeLabel = queueState?.status === 'on_call'
    ? queueState.callDuration || '00:00'
    : queueState?.status === 'calling'
    ? 'Dialing'
    : 'Idle'

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
            href="/leads"
            className="inline-flex items-center gap-2 bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
          >
            <Icon name="arrow_back" size="text-sm" /> Back to leads
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
      {/* ── Session HUD (Mojo/CallTools-style command bar) ───────────────── */}
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 mb-4 border-b border-[var(--ck-border)] bg-[var(--ck-surface)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--ck-surface)]/75">
        <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
          <button
            onClick={closeSession}
            className="shrink-0 w-10 h-10 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text-muted)] flex items-center justify-center transition-colors"
            title="Exit session"
            aria-label="Exit session"
          >
            <Icon name="close" size="text-xl" />
          </button>

          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#E32E2E] leading-none">
              {inferredQueueLabel}
            </p>
            <p className="mt-1 text-sm font-black text-[var(--ck-text)] leading-none">
              Lead {currentIndex + 1}<span className="text-[var(--ck-text-dim)] font-bold"> / {leadIds.length}</span>
              {sessionCallerId && (
                <span className="ml-2 text-[11px] font-semibold text-[var(--ck-text-muted)]">from {formatPhone(sessionCallerId)}</span>
              )}
            </p>
          </div>

          {/* Stat chips */}
          <div className="hidden md:flex items-center gap-2 ml-1">
            <HudStat icon="call" label="Dials" value={sessionDials} />
            <HudStat icon="phone_in_talk" label="Contacts" value={sessionContacts} tone="emerald" />
            {queueState?.queueLength ? (
              <HudStat icon="diversity_3" label="Heir" value={`${queueState.queueIndex + 1}/${queueState.queueLength}`} />
            ) : null}
          </div>

          <div className="flex-1" />

          {/* Live dial state */}
          <div className={`hidden sm:flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
            isCallingNow ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)]'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isCallingNow ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--ck-text-dim)]'}`} />
            <span className={`text-[10px] font-black uppercase tracking-wider ${isCallingNow ? 'text-emerald-400' : 'text-[var(--ck-text-dim)]'}`}>
              {queueState?.status === 'on_call' ? 'On call' : queueState?.status === 'calling' ? 'Dialing' : 'Idle'}
            </span>
            <span className="font-mono text-xs tabular-nums text-[var(--ck-text)]">{dialTimeLabel}</span>
          </div>

          {/* Mark lead dead */}
          <button
            onClick={() => { setMarkDeadReason(''); setMarkDeadError(null); setShowMarkDead(true) }}
            disabled={!currentLeadId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E32E2E]/40 text-[#ff7777] hover:bg-[#E32E2E]/10 text-xs font-bold uppercase tracking-wider disabled:opacity-30 transition-colors"
            title="Mark this lead dead (records why)"
          >
            <Icon name="cancel" size="text-sm" /> <span className="hidden lg:inline">Mark dead</span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={back}
              disabled={currentIndex === 0}
              className="inline-flex items-center justify-center w-10 h-9 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous lead (K / ←)"
              aria-label="Previous lead"
            >
              <Icon name="chevron_left" size="text-base" />
            </button>
            <button
              onClick={() => advance()}
              disabled={currentIndex >= leadIds.length - 1}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#E32E2E] hover:bg-[#C42626] text-white text-xs font-black uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next lead (J / →)"
            >
              Next <Icon name="chevron_right" size="text-sm" />
            </button>
          </div>
        </div>

        {/* Progress bar hugs the bottom of the HUD */}
        <div className="h-1 bg-[var(--ck-surface-hi)]">
          <div className="h-full bg-[#E32E2E] transition-all" style={{ width: `${Math.round(((currentIndex + 1) / Math.max(leadIds.length, 1)) * 100)}%` }} />
        </div>
      </div>

      {/* ── Now Calling hero ─────────────────────────────────────────────── */}
      {queueState?.queueItem && (
        <div
          className={`mb-5 rounded-2xl border p-5 sm:p-6 flex items-center justify-between gap-4 ${
            isCallingNow ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-[#E32E2E]/10 border-[#E32E2E]/30'
          }`}
        >
          <div className="flex items-center gap-4 min-w-0">
            <span className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
              isCallingNow ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#E32E2E]/20 text-[#ff7777]'
            }`}>
              <Icon name={queueState.status === 'on_call' ? 'phone_in_talk' : 'call'} size="text-2xl" className={isCallingNow ? 'animate-pulse' : ''} filled />
            </span>
            <div className="min-w-0">
              <p className={`text-[10px] font-black uppercase tracking-widest ${isCallingNow ? 'text-emerald-400' : 'text-[#ff7777]'}`}>
                {isCallingNow ? (queueState.status === 'on_call' ? 'On call now' : 'Dialing now') : 'Up next'}
              </p>
              <p className="text-xl font-black text-[var(--ck-text)] truncate leading-tight">
                {queueState.queueItem.heirName}
                <span className="text-[var(--ck-text-muted)] font-semibold capitalize text-base"> · {queueState.queueItem.relation}</span>
              </p>
              <p className="text-sm font-mono text-[var(--ck-text-muted)]">{formatPhone(queueState.queueItem.phone)}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Talk time</p>
            <p className="text-2xl font-black text-[var(--ck-text)] tabular-nums font-mono leading-tight">{dialTimeLabel}</p>
            <p className="text-[11px] font-bold text-[var(--ck-text-muted)] mt-0.5">Heir {queueState.queueIndex + 1} of {queueState.queueLength}</p>
          </div>
        </div>
      )}

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

          {/* Activity + recent call history */}
          <section className="ck-card p-5">
            <div className="flex items-center justify-between mb-3 gap-3">
              <div className="inline-flex rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-0.5">
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
                {leftTab === 'activity' ? `${commsEvents.length} touches` : `${recentCalls.length} recent`}
              </span>
            </div>
            {leftTab === 'activity' ? (
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
                disabled={!markDeadReason || markDeadBusy}
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

function DialerHome() {
  const router = useRouter()
  const [leads, setLeads] = useState<DialerQueueLead[]>([])
  const [followups, setFollowups] = useState<QueueFollowup[]>([])
  const [contactActivities, setContactActivities] = useState<QueueContactActivity[]>([])
  const [prospects, setProspects] = useState<QueueProspect[]>([])
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
  const [autoSendEmail, setAutoSendEmail] = useState(false)
  const [voicemailDrop, setVoicemailDrop] = useState('none')
  const [callbackDrop, setCallbackDrop] = useState('none')
  const [ringCount, setRingCount] = useState(6)
  const [useCallHammer, setUseCallHammer] = useState(true)
  const [useVoicemailCallHammer, setUseVoicemailCallHammer] = useState(false)
  const [mode, setMode] = useState<'power' | 'predictive'>('power')
  const [pacing, setPacing] = useState(18)
  const [showBulkSms, setShowBulkSms] = useState(false)

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
      const response = await fetch('/api/dialer/saved-lists', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) {
        setSavedQueueError(payload?.error || 'Could not load saved lists.')
        setSavedQueues([])
        return
      }
      const serverQueues = (payload.savedLists || []) as SavedDialerQueue[]
      setSavedQueues(serverQueues.map(mergeSavedQueueWithLocalMeta))
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
          setLoading(false)
          return
        }
        setLeads((payload.leads as DialerQueueLead[] | null) ?? [])
        setFollowups((payload.followups as QueueFollowup[] | null) ?? [])
        setContactActivities((payload.contactActivities as QueueContactActivity[] | null) ?? [])
        setProspects((payload.prospects as QueueProspect[] | null) ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load dialer queue.')
        setLeads([])
        setFollowups([])
        setContactActivities([])
        setProspects([])
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
          const minDays = Number(optionalFilters.notContactedDays)
          if (Number.isFinite(minDays)) {
            const lastContact = lastContactByLeadId.get(lead.id)
            if (lastContact) {
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
    return `/dialer?${query.toString()}`
  }, [])

  const startQueue = useCallback(async (dialerMode: 'click_to_call' | 'power_dialer' = 'power_dialer') => {
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

    if (dialerMode === 'click_to_call') {
      setMode('power')
      setPacing((current) => Math.max(current, 18))
    } else {
      setMode('predictive')
      setPacing((current) => Math.min(current, 12))
    }

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

    router.push(buildSessionUrl(
      ids,
      startIndex,
      activeSavedQueueId || undefined,
      callerPlan.staticCallerId,
      callerPlan,
      { useCallHammer, useVoicemailCallHammer },
      selectedSavedQueue?.name || selectedPreset.label,
    ))
  }, [activeSavedQueueId, buildSessionUrl, callerPlan, optionalFilters, queue, router, selectedPreset.label, selectedQueue, selectedSavedQueue, startBehavior, useCallHammer, useVoicemailCallHammer])

  const resumeSavedQueue = useCallback(() => {
    if (!selectedSavedQueue) return
    const ids = (selectedSavedQueue.sessionLeadIds || []).slice(0, 100)
    if (ids.length === 0) return
    const resumeIndex = Math.min(
      Math.max(selectedSavedQueue.resumeIndex || 0, 0),
      Math.max(ids.length - 1, 0),
    )
    const resumePlan = normalizeDialerCallerPlan({
      mode: selectedSavedQueue.callerMode || callerMode,
      staticCallerId: selectedSavedQueue.callerId || callerId,
      rotationCallerIds: selectedSavedQueue.rotationCallerIds || rotationCallerIds,
      rotateEveryCalls: selectedSavedQueue.rotateEveryCalls || rotateEveryCalls,
      redialCallerId: selectedSavedQueue.redialCallerId || redialCallerId || null,
    }, selectedSavedQueue.callerId || callerId || DEFAULT_DIALER_CALLER_ID)
    patchSavedListMeta(selectedSavedQueue.id, {
      callerId: resumePlan.staticCallerId,
      callerMode: resumePlan.mode,
      rotationCallerIds: resumePlan.rotationCallerIds,
      rotateEveryCalls: resumePlan.rotateEveryCalls,
      redialCallerId: resumePlan.redialCallerId,
      useCallHammer: selectedSavedQueue.useCallHammer ?? useCallHammer,
      useVoicemailCallHammer: selectedSavedQueue.useVoicemailCallHammer ?? useVoicemailCallHammer,
    })
    router.push(buildSessionUrl(
      ids,
      resumeIndex,
      selectedSavedQueue.id,
      resumePlan.staticCallerId,
      resumePlan,
      {
        useCallHammer: selectedSavedQueue.useCallHammer ?? useCallHammer,
        useVoicemailCallHammer: selectedSavedQueue.useVoicemailCallHammer ?? useVoicemailCallHammer,
      },
      selectedSavedQueue.name,
    ))
  }, [buildSessionUrl, callerId, callerMode, redialCallerId, rotateEveryCalls, rotationCallerIds, router, selectedSavedQueue, useCallHammer, useVoicemailCallHammer])

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
  const canStart = queue.length > 0
  const lineDialCount = mode === 'predictive' ? 3 : 1

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
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24">
      <BulkSmsModal
        open={showBulkSms}
        onClose={() => setShowBulkSms(false)}
        leadIds={(selectedCount > 0 ? selectedQueue : queue).map((lead) => lead.id)}
        agent={agent}
        fromPhone={callerId}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-[var(--ck-text)] tracking-tight">Calling Command Center</h1>
          <p className="mt-1 text-sm text-[var(--ck-text-muted)]">Pick a queue, confirm the session, start calling.</p>
        </div>
        <div className="text-sm font-bold text-[var(--ck-text-muted)]">
          {loading ? 'Loading queue...' : selectedCount > 0 ? `${selectedCount.toLocaleString()} selected` : `${queue.length.toLocaleString()} ready`}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#E32E2E]/30 bg-[#E32E2E]/10 p-4 text-sm text-[#ffb4b4]">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-start">
        <main className="space-y-5">
          <section className="ck-card p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px] md:items-end">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Calling Queue</span>
                <select
                  value={preset}
                  onChange={(event) => {
                    setPreset(event.target.value as QueuePreset)
                    setSelectedLeadIds(new Set())
                  }}
                  className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-3 text-base font-bold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                >
                  {QUEUE_PRESETS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Calling Number</span>
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
                  className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-3 text-sm font-bold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                >
                  {TWILIO_NUMBERS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => startQueue('power_dialer')}
                  disabled={queue.length === 0}
                  className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-[#E32E2E] px-4 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Icon name="play_arrow" size="text-sm" /> {selectedCount > 0 ? `Start ${selectedCount}` : 'Start Queue'}
                </button>
                <button
                  onClick={() => setShowBulkSms(true)}
                  disabled={queue.length === 0}
                  title={selectedCount > 0 ? `Text ${selectedCount} selected leads` : 'Text the leads in this queue'}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)] transition-colors hover:border-[#E32E2E] hover:text-[#ff7777] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Icon name="forum" size="text-lg" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2 text-sm text-[var(--ck-text-muted)] sm:flex-row sm:items-center sm:justify-between">
              <span>{selectedPreset.description} · from {formatPhone(callerId || DEFAULT_DIALER_CALLER_ID)}</span>
              <span className="font-bold text-[var(--ck-text)]">{loading ? '...' : queue.length.toLocaleString()} leads</span>
            </div>

            <button
              onClick={() => setShowQueueControls((value) => !value)}
              className="mt-5 flex w-full items-center justify-between rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]"
              aria-expanded={showQueueControls}
            >
              <span>
                Saved lists and filters
                {activeFilterCount > 0 && <span className="ml-2 text-[#ff7777]">{activeFilterCount} active</span>}
              </span>
              <Icon name={showQueueControls ? 'expand_less' : 'expand_more'} size="text-lg" />
            </button>

            {showQueueControls && (
              <>
                <div className="mt-3 border-t border-[var(--ck-border)] pt-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_112px_88px] md:items-end">
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
                      className="rounded-lg border border-[#E32E2E]/45 bg-[#E32E2E]/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-[#ff7777] transition-colors hover:border-[#E32E2E]"
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
                    <p className="mt-3 text-xs font-bold text-[#ff7777]">{savedQueueError}</p>
                  )}
                  {selectedSavedQueue && !savedQueueError && (
                    <p className="mt-3 text-xs text-[var(--ck-text-muted)]">
                      Loaded from database for {selectedSavedQueue.agent}. Updated {formatActivityTime(selectedSavedQueue.updatedAt)}.
                      {selectedSavedQueue.callerId ? ` Calling from ${formatPhone(selectedSavedQueue.callerId)}.` : ''}
                    </p>
                  )}
                  {selectedSavedQueue && hasResumePoint && !savedQueueError && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={resumeSavedQueue}
                        className="rounded-lg border border-[#E32E2E]/45 bg-[#E32E2E]/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-[#ff7777] transition-colors hover:border-[#E32E2E]"
                      >
                        Resume where left off
                      </button>
                      <span className="text-xs text-[var(--ck-text-muted)]">
                        Lead {(selectedSavedQueue.resumeIndex || 0) + 1} of {resumeLeadIds.length} · {resumeRemaining} remaining
                        {selectedSavedQueue.resumeUpdatedAt ? ` · updated ${formatActivityTime(selectedSavedQueue.resumeUpdatedAt)}` : ''}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <DarkSelect label="Campaign" value={campaign} onChange={(value) => { setCampaign(value); setSelectedLeadIds(new Set()) }} options={sourceOptions} />
                  <DarkSelect label="Status" value={statusFilter} onChange={(value) => { setStatusFilter(value); setSelectedLeadIds(new Set()) }} options={statusOptions} />
                  <DarkSelect label="Priority" value={priorityFilter} onChange={(value) => { setPriorityFilter(value); setSelectedLeadIds(new Set()) }} options={['all', 'hot', 'high', 'normal']} />
                  <DarkSelect label="Sort" value={sortBy} onChange={(value) => setSortBy(value as QueueSort)} options={QUEUE_SORTS.map((item) => item.id)} />
                  <DarkSelect label="Show" value={String(visibleLimit)} onChange={(value) => setVisibleLimit(Number(value))} options={['25', '50', '100']} />
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Motivation {minMotivation}+</span>
                    <input type="range" min="0" max="10" value={minMotivation} onChange={(e) => { setMinMotivation(Number(e.target.value)); setSelectedLeadIds(new Set()) }} className="mt-3 w-full accent-[#E32E2E]" />
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
                  <button onClick={selectVisibleLeads} disabled={previewLeads.length === 0} className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)] disabled:opacity-35">
                    Select shown
                  </button>
                  {selectedCount > 0 && (
                    <button onClick={clearSelectedLeads} className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]">
                      Clear selected
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="ck-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--ck-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-[var(--ck-text)]">Queue Preview</p>
                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Showing {previewLeads.length} records. Check only the leads you want to call.</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--ck-text-muted)]">
                <span>{selectedVisibleCount}/{previewLeads.length} shown selected</span>
                <span className="hidden sm:inline">/</span>
                <span>{selectedCount.toLocaleString()} total selected</span>
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
                <div key={lead.id} className="grid gap-3 border-b border-[var(--ck-border)] px-5 py-4 md:grid-cols-[28px_34px_minmax(0,1fr)_145px_88px] md:items-center hover:bg-white/[0.03] transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.has(lead.id)}
                    onChange={() => toggleLeadSelection(lead.id)}
                    aria-label={`Select ${lead.full_name || 'lead'}`}
                    className="h-4 w-4 rounded border-[var(--ck-border)] bg-[var(--ck-surface-elev)] accent-[#E32E2E]"
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

        <aside className="lg:sticky lg:top-24 space-y-4">
          <section className="ck-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold tracking-[-0.02em] text-[var(--ck-text)]">Call Wizard</p>
                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">{selectedPreset.label}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tracking-[-0.02em] text-[var(--ck-text)]">{loading ? '...' : (selectedCount || queue.length).toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">{selectedCount > 0 ? 'selected' : 'ready'}</p>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Caller ID Settings</p>
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-1">
                  <button
                    onClick={() => setCallerMode('static')}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${callerMode === 'static' ? 'bg-white text-black' : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'}`}
                  >
                    Static
                  </button>
                  <button
                    onClick={() => setCallerMode('rotation')}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${callerMode === 'rotation' ? 'bg-white text-black' : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'}`}
                  >
                    Rotation
                  </button>
                </div>
                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Default Caller ID</span>
                  <select
                    value={callerId}
                    onChange={(event) => {
                      const value = event.target.value
                      setCallerId(value)
                      if (!rotationCallerIds.includes(value)) setRotationCallerIds((current) => [value, ...current.filter((item) => item !== value)])
                    }}
                    className="mt-1.5 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                  >
                    {TWILIO_NUMBERS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {hasRotation && (
                  <div className="mt-3 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[var(--ck-text-muted)]">Currently rotating every <strong className="text-[var(--ck-text)]">{rotateEveryCalls}</strong> calls</span>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={rotateEveryCalls}
                        onChange={(event) => setRotateEveryCalls(Math.max(1, Number(event.target.value) || 1))}
                        className="w-16 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2 py-1 text-right text-xs font-semibold text-[var(--ck-text)]"
                      />
                    </div>
                    <div className="mt-2 max-h-28 overflow-auto space-y-1.5 pr-1">
                      {TWILIO_NUMBERS.map((option) => {
                        const checked = rotationCallerIds.includes(option.value)
                        return (
                          <label key={option.value} className="flex items-center gap-2 text-xs text-[var(--ck-text-muted)]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRotationCallerId(option.value)}
                              className="h-3.5 w-3.5 accent-[#E32E2E]"
                            />
                            <span className={checked ? 'text-[var(--ck-text)]' : ''}>{option.label}</span>
                          </label>
                        )
                      })}
                    </div>
                    <p className="mt-2 text-[10px] text-[var(--ck-text-dim)]">{rotationSummary || 'Select at least one number for rotation.'}</p>
                  </div>
                )}
                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Redial Caller ID</span>
                  <select
                    value={redialCallerId}
                    onChange={(event) => setRedialCallerId(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                  >
                    <option value="">Use current caller</option>
                    {TWILIO_NUMBERS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                onClick={() => setShowWizardAdvanced((current) => !current)}
                className="w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-left text-xs font-semibold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon name={showWizardAdvanced ? 'expand_less' : 'expand_more'} size="text-base" />
                  {showWizardAdvanced ? 'Hide Advanced Settings' : 'Show Advanced Settings'}
                </span>
              </button>

              {showWizardAdvanced && (
                <div className="space-y-5 border-t border-[var(--ck-border)] pt-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Message Settings</p>
                    <div className="mt-2 space-y-2">
                      <DarkSelect label="Voicemail Drop" value={voicemailDrop} onChange={setVoicemailDrop} options={['none', 'default']} />
                      <DarkSelect label="Callback Message" value={callbackDrop} onChange={setCallbackDrop} options={['none', 'default']} />
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Line Settings</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Lines</span>
                        <input
                          value={lineDialCount}
                          readOnly
                          className="mt-1.5 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Rings</span>
                        <select
                          value={String(ringCount)}
                          onChange={(event) => setRingCount(Math.max(1, Number(event.target.value) || 6))}
                          className="mt-1.5 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)]"
                        >
                          {['3', '4', '5', '6', '7', '8'].map((value) => (
                            <option key={value} value={value}>{value} rings</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Voicemail Call Hammer</p>
                    <div className="mt-2 space-y-2 text-sm text-[var(--ck-text-muted)]">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={useVoicemailCallHammer} onChange={(event) => setUseVoicemailCallHammer(event.target.checked)} className="h-4 w-4 accent-[#E32E2E]" />
                        <span>Enable voicemail call hammer mode</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="ck-card p-5">
            <p className="text-lg font-semibold tracking-[-0.02em] text-[var(--ck-text)]">Easy Calling Mode</p>
            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Choose how you want to call this list.</p>

            <div className="mt-4 space-y-2 text-sm text-[var(--ck-text-muted)]">
              <label className="flex items-start gap-2">
                <input type="radio" name="startBehavior" checked={startBehavior === 'resume'} onChange={() => setStartBehavior('resume')} className="mt-1 h-4 w-4 accent-[#E32E2E]" />
                <span>Call this list from where I last left off, starting with new leads first.</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="startBehavior" checked={startBehavior === 'top'} onChange={() => setStartBehavior('top')} className="mt-1 h-4 w-4 accent-[#E32E2E]" />
                <span>Call this list top to bottom regardless of where I last left off.</span>
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
              <label className="flex items-center justify-between gap-3 text-sm text-[var(--ck-text)]">
                <span className="font-semibold">Use Call Hammer</span>
                <input
                  type="checkbox"
                  checked={useCallHammer}
                  onChange={(event) => setUseCallHammer(event.target.checked)}
                  className="h-4 w-4 accent-[#E32E2E]"
                />
              </label>
              <p className="mt-2 text-[11px] text-[var(--ck-text-muted)]">
                On: call all available numbers for each contact. Off: call only the first listed number.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setAutoSendEmail((current) => !current)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${autoSendEmail ? 'bg-[#E32E2E] text-white' : 'border border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'}`}
              >
                {autoSendEmail ? 'Auto Email On' : 'Auto Send Email'}
              </button>
              <button
                onClick={openOptionalFilterModal}
                className="rounded-xl border border-[var(--ck-border)] px-3 py-2 text-xs font-semibold text-[var(--ck-text-muted)] transition-colors hover:border-[#E32E2E]/50 hover:text-[var(--ck-text)]"
              >
                Optional Dialing Filters
                {optionalFilterCount > 0 ? ` (${optionalFilterCount})` : ''}
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => startQueue('click_to_call')}
                disabled={!canStart}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E9E68] px-3 py-2.5 text-xs font-black uppercase tracking-[0.06em] text-white transition-colors hover:bg-[#168056] disabled:opacity-35"
              >
                <Icon name="call" size="text-sm" /> Start Click To Call
              </button>
              <button
                onClick={() => startQueue('power_dialer')}
                disabled={!canStart}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E9E68] px-3 py-2.5 text-xs font-black uppercase tracking-[0.06em] text-white transition-colors hover:bg-[#168056] disabled:opacity-35"
              >
                <Icon name="auto_awesome_motion" size="text-sm" /> Start Power Dialer
              </button>
            </div>

            <button
              onClick={saveCurrentQueue}
              className="mt-3 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-xs font-semibold text-[var(--ck-text-muted)] transition-colors hover:border-[#E32E2E]/50 hover:text-[var(--ck-text)]"
            >
              Save Calling Profile As
            </button>

            <div className="mt-3 flex items-center justify-between text-xs text-[var(--ck-text-muted)]">
              <button onClick={selectVisibleLeads} disabled={previewLeads.length === 0} className="font-bold transition-colors hover:text-[var(--ck-text)] disabled:opacity-35">
                Select shown
              </button>
              <button onClick={clearSelectedLeads} disabled={selectedCount === 0} className="font-bold transition-colors hover:text-[var(--ck-text)] disabled:opacity-35">
                Clear
              </button>
            </div>

            {hasResumePoint && (
              <div className="mt-4 rounded-xl border border-[#E32E2E]/35 bg-[#E32E2E]/10 p-3">
                <p className="text-xs font-semibold text-[#ff9f9f]">
                  Resume available: lead {(selectedSavedQueue?.resumeIndex || 0) + 1} of {resumeLeadIds.length}
                </p>
                <button
                  onClick={resumeSavedQueue}
                  className="mt-2 rounded-lg bg-[#E32E2E] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.06em] text-white"
                >
                  Resume Where Left Off
                </button>
              </div>
            )}

            <div className="mt-4 border-t border-[var(--ck-border)] pt-4">
              <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Next Up</p>
              {currentLead ? (
                <div className="mt-2">
                  <p className="text-sm font-semibold text-[var(--ck-text)] leading-tight">{toProperCase(currentLead.full_name) || 'Unknown Lead'}</p>
                  <p className="mt-1 text-xs font-mono text-[#E32E2E]">{formatPhone(currentLead.phone || '')}</p>
                  <button
                    onClick={() => router.push(buildSessionUrl(
                      [currentLead.id],
                      0,
                      activeSavedQueueId || undefined,
                      callerPlan.staticCallerId,
                      callerPlan,
                      { useCallHammer, useVoicemailCallHammer },
                    ))}
                    className="mt-3 w-full rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-semibold text-[var(--ck-text-muted)] transition-colors hover:border-[#E32E2E]/50 hover:text-[var(--ck-text)]"
                  >
                    Open Lead
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-[var(--ck-text-muted)]">Select a queue with callable leads.</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      {showOptionalFilters && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close optional dialing filters"
            onClick={() => setShowOptionalFilters(false)}
            className="absolute inset-0 bg-black/55 backdrop-blur-[6px]"
          />
          <div className="relative z-[1] w-full max-w-[640px] rounded-2xl border border-[#D4D4D8] bg-white shadow-[0_24px_64px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#E4E4E7] px-5 py-4">
              <h3 className="text-2xl font-semibold tracking-[-0.02em] text-[#111111]">Optional Dialing Filters</h3>
              <button
                onClick={() => setShowOptionalFilters(false)}
                className="h-9 w-9 rounded-lg border border-[#E4E4E7] text-[#71717A] transition-colors hover:bg-[#F4F4F5] hover:text-[#27272A]"
              >
                <Icon name="close" size="text-lg" />
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#71717A]">Stop Call Attempts</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    value={optionalFiltersDraft.attemptsFrom}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, attemptsFrom: event.target.value }))}
                    placeholder="From"
                    className="w-full rounded-lg border border-[#D4D4D8] bg-[#FAFAFA] px-3 py-2 text-sm font-medium text-[#111111] outline-none focus:border-[#E32E2E]"
                  />
                  <input
                    type="number"
                    min={0}
                    value={optionalFiltersDraft.attemptsTo}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, attemptsTo: event.target.value }))}
                    placeholder="To"
                    className="w-full rounded-lg border border-[#D4D4D8] bg-[#FAFAFA] px-3 py-2 text-sm font-medium text-[#111111] outline-none focus:border-[#E32E2E]"
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
                  { value: '1', label: '1 Day' },
                  { value: '3', label: '3 Days' },
                  { value: '7', label: '7 Days' },
                  { value: '14', label: '14 Days' },
                  { value: '30', label: '30 Days' },
                ]}
              />

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#71717A]">Create Date</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={optionalFiltersDraft.createDateFrom}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, createDateFrom: event.target.value }))}
                    className="w-full rounded-lg border border-[#D4D4D8] bg-[#FAFAFA] px-3 py-2 text-sm font-medium text-[#111111] outline-none focus:border-[#E32E2E]"
                  />
                  <input
                    type="date"
                    value={optionalFiltersDraft.createDateTo}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, createDateTo: event.target.value }))}
                    className="w-full rounded-lg border border-[#D4D4D8] bg-[#FAFAFA] px-3 py-2 text-sm font-medium text-[#111111] outline-none focus:border-[#E32E2E]"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#71717A]">Status Change</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={optionalFiltersDraft.statusChangeFrom}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, statusChangeFrom: event.target.value }))}
                    className="w-full rounded-lg border border-[#D4D4D8] bg-[#FAFAFA] px-3 py-2 text-sm font-medium text-[#111111] outline-none focus:border-[#E32E2E]"
                  />
                  <input
                    type="date"
                    value={optionalFiltersDraft.statusChangeTo}
                    onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, statusChangeTo: event.target.value }))}
                    className="w-full rounded-lg border border-[#D4D4D8] bg-[#FAFAFA] px-3 py-2 text-sm font-medium text-[#111111] outline-none focus:border-[#E32E2E]"
                  />
                </div>
              </label>
            </div>

            <div className="px-5 pb-2">
              <label className="inline-flex items-center gap-2 text-sm text-[#27272A]">
                <input
                  type="checkbox"
                  checked={optionalFiltersDraft.callOldestToNewest}
                  onChange={(event) => setOptionalFiltersDraft((current) => ({ ...current, callOldestToNewest: event.target.checked }))}
                  className="h-4 w-4 accent-[#E32E2E]"
                />
                Call oldest to newest
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3 border-t border-[#E4E4E7] px-5 py-4">
              <button
                onClick={() => setShowOptionalFilters(false)}
                className="rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-3 py-2 text-sm font-semibold text-[#3F3F46] transition-colors hover:bg-[#E4E4E7]"
              >
                Cancel
              </button>
              <button
                onClick={clearOptionalFilterDraft}
                className="rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-3 py-2 text-sm font-semibold text-[#3F3F46] transition-colors hover:bg-[#E4E4E7]"
              >
                Clear
              </button>
              <button
                onClick={applyOptionalFilterDraft}
                className="rounded-lg bg-[#1559C4] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0E48A5]"
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
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#71717A]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-[#D4D4D8] bg-[#FAFAFA] px-3 py-2 text-sm font-medium text-[#111111] outline-none focus:border-[#E32E2E]"
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
        className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
      >
        {options.map((option) => (
          <option key={option} value={option}>{formatSelectOption(option)}</option>
        ))}
      </select>
    </label>
  )
}

function SegmentedControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Mode</span>
      <div className="mt-2 grid grid-cols-2 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-1">
        {['power', 'predictive'].map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`rounded-md px-3 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
              value === option ? 'bg-[#E32E2E] text-white' : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

function HudStat({ icon, label, value, tone = 'neutral' }: { icon: string; label: string; value: number | string; tone?: 'neutral' | 'emerald' }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2.5 py-1.5">
      <Icon name={icon} size="text-sm" className={tone === 'emerald' ? 'text-emerald-400' : 'text-[var(--ck-text-dim)]'} />
      <div className="leading-none">
        <p className={`text-sm font-black tabular-nums ${tone === 'emerald' ? 'text-emerald-400' : 'text-[var(--ck-text)]'}`}>{value}</p>
        <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p>
      </div>
    </div>
  )
}

function DarkPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'red' }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${tone === 'red' ? 'bg-[#E32E2E]/15 text-[#ff7777]' : 'bg-white/5 text-[var(--ck-text-muted)]'}`}>
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
