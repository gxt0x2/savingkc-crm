import type { DialerCallerPlan } from '@/lib/dialer-caller-plan'
import { formatPhone } from '@/lib/format'

export interface SearchResult {
  id: string
  full_name: string
  phone: string | null
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  updated_at: string
}

export interface RecentCall {
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

type TwilioErrorLike = {
  message?: string
  explanation?: string
  name?: string
}

export function resolveCallerIdForAttempt(plan: DialerCallerPlan, fallbackCallerId: string, attemptsPlaced: number): string {
  if (plan.mode !== 'rotation' || plan.rotationCallerIds.length === 0) return plan.staticCallerId || fallbackCallerId
  const safeEvery = Math.max(1, Math.floor(plan.rotateEveryCalls || 1))
  const index = Math.floor(Math.max(0, attemptsPlaced) / safeEvery) % plan.rotationCallerIds.length
  return plan.rotationCallerIds[index] || plan.staticCallerId || fallbackCallerId
}

export function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  return `${m}:${String(secs % 60).padStart(2, '0')}`
}

export function extractTwilioErrorMessage(err: unknown): string {
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

export function isNonFatalAudioWarning(err: unknown): boolean {
  const msg = extractTwilioErrorMessage(err).toLowerCase()
  return msg.includes('audio output') || msg.includes('setsinkid') || msg.includes('audio device') || msg.includes('devices not found')
}

export function normalizeDispositionLabel(disposition: string) {
  return disposition.replace(/_/g, ' ')
}

export function classifyDirection(metadata: RecentCall['metadata']): 'inbound' | 'outbound' | 'unknown' {
  if (metadata?.direction === 'inbound') return 'inbound'
  if (metadata?.direction === 'outbound') return 'outbound'
  return 'unknown'
}

export function isNoAnswer(metadata: RecentCall['metadata']): boolean {
  if (!metadata) return false
  return metadata.disposition === 'no_answer'
    || metadata.outcome === 'missed'
    || metadata.callStatus === 'no-answer'
    || metadata.callStatus === 'busy'
    || metadata.dialStatus === 'no-answer'
    || metadata.dialStatus === 'busy'
}

export function formatCallLeg(call: RecentCall): string {
  const direction = classifyDirection(call.metadata)
  const from = call.metadata?.from || null
  const to = call.metadata?.to || call.phone || null
  if (direction === 'outbound' && to) return `To ${formatPhone(to)}`
  if (direction === 'inbound' && from && to) return `From ${formatPhone(from)} → To ${formatPhone(to)}`
  if (direction === 'inbound' && from) return `From ${formatPhone(from)}`
  return to ? formatPhone(to) : 'Unknown number'
}

export const stationColors: Record<string, string> = {
  intake: 'bg-blue-500/20 text-blue-300',
  qualifying: 'bg-amber-500/20 text-amber-300',
  appt_set: 'bg-purple-500/20 text-purple-300',
  negotiations: 'bg-orange-500/20 text-orange-300',
  contract_signed: 'bg-emerald-500/20 text-emerald-300',
  closed: 'bg-green-500/20 text-green-300',
  dead: 'bg-slate-500/20 text-slate-400',
}

export const priorityColors: Record<string, string> = {
  hot: 'bg-red-500/20 text-red-300',
  warm: 'bg-amber-500/20 text-amber-300',
  normal: 'bg-slate-500/20 text-slate-400',
  cold: 'bg-cyan-500/20 text-cyan-300',
}

export const DIALER_KEYPAD: Array<{ value: string; letters?: string }> = [
  { value: '1' }, { value: '2', letters: 'ABC' }, { value: '3', letters: 'DEF' },
  { value: '4', letters: 'GHI' }, { value: '5', letters: 'JKL' }, { value: '6', letters: 'MNO' },
  { value: '7', letters: 'PQRS' }, { value: '8', letters: 'TUV' }, { value: '9', letters: 'WXYZ' },
  { value: '*' }, { value: '0', letters: '+' }, { value: '#' },
]

export function stripDialFormatting(input: string): string {
  return input.replace(/[()\s-]/g, '')
}

export function formatDialDisplay(input: string): string {
  const raw = stripDialFormatting(input).trim()
  if (!raw) return ''
  if (raw.includes('*') || raw.includes('#')) return raw
  return /^\+?\d+$/.test(raw) ? formatPhone(raw) : raw
}
