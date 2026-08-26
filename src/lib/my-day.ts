import { formatLeadSource } from '@/lib/contact-display'
import { isReachedDisposition } from '@/lib/dialer-dispositions'
import { playableRecordingUrl, readCallReviewWorkflow, readRecordingReview } from '@/lib/marketing/call-recordings'
import { stageLabel } from '@/lib/utils'
import {
  MY_DAY_TIME_ZONE,
  startOfMyDayWeek,
  type MyDayDateRange,
} from '@/lib/my-day-range'

export {
  MY_DAY_TIME_ZONE,
  resolveMyDayDateRange,
  type MyDayDateRange,
  type MyDayRangePreset,
  type MyDayRangeRequest,
} from '@/lib/my-day-range'

export interface MyDayAgentStat {
  date: string
  calls_made: number | null
  meaningful_conversations: number | null
  followups_completed: number | null
  followups_missed: number | null
  metadata: Record<string, unknown> | null
}

export interface MyDayPerformanceRow {
  metric_date: string
  dialing_seconds: number | null
  in_progress_seconds: number | null
  calls: number | null
  contacts: number | null
  leads: number | null
  appointments: number | null
  source_fetched_at: string
}

export interface MyDayNativeDialerPerformanceRow {
  metric_date: string
  dialing_seconds: number
  calls: number
  contacts: number
}

export interface MyDayLead {
  id: string
  full_name: string | null
  phone: string | null
  property_address: string | null
  city: string | null
  source: string | null
  station: string | null
  priority: string | null
  assigned_agent: string | null
  created_at: string
  updated_at: string | null
}

export interface MyDayActivity {
  id: string
  lead_id: string | null
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface MyDayAppointment {
  id: string
  lead_id: string | null
  type: string | null
  status: string | null
  scheduled_at: string | null
  assigned_to: string | null
  address: string | null
  notes: string | null
  created_at: string
}

export interface MyDayGoalSet {
  dailyCalls: number | null
  weeklyOpportunities: number | null
  weeklyAppointments: number | null
}

export interface MyDayMetric {
  key: 'calls' | 'contacts' | 'leads' | 'opportunities' | 'appointments' | 'offers' | 'contracts'
  label: string
  value: number | null
  conversion: number | null
  icon: string
  tone: 'blue' | 'violet' | 'coral' | 'sky' | 'green' | 'indigo'
}

export interface MyDayWeeklyRow {
  key: 'calls' | 'contacts' | 'leads' | 'opportunities' | 'appointments' | 'offers' | 'contracts'
  label: string
  icon: string
  tone: MyDayMetric['tone']
  days: Array<number | null>
  total: number | null
}

export interface MyDayHabit {
  key: 'vision' | 'objections' | 'followup' | 'calling'
  label: string
  value: number | null
}

export interface MyDayCommitment {
  id: string
  title: string
  detail: string
  dueAt: string
  icon: string
  href: string
}

export interface MyDayQueueItem {
  id: string
  taskId: string
  leadId: string | null
  leadName: string
  property: string
  phone: string | null
  stage: string
  source: string
  priority: 'High' | 'Medium' | 'Low'
  action: 'Call' | 'SMS' | 'Open'
  dueAt: string | null
}

export interface MyDayCallReview {
  id: string
  leadId: string
  leadName: string
  happenedAt: string
  reason: string
  aiScore: number | null
  status: 'available' | 'submitted'
  href: string
}

export interface MyDayData {
  month: string
  monthLabel: string
  range: MyDayDateRange
  generatedAt: string
  agent: { name: 'Casey'; initials: 'C' }
  performance: {
    source: 'mojo' | 'combined' | 'native_dialer'
    status: 'available' | 'partial' | 'unavailable'
    dialingSeconds: number | null
    sourceFetchedAt: string | null
  }
  funnel: MyDayMetric[]
  week: {
    start: string
    end: string
    dayLabels: string[]
    rows: MyDayWeeklyRow[]
  }
  habits: MyDayHabit[]
  commitments: MyDayCommitment[]
  queue: MyDayQueueItem[]
  callReviews: MyDayCallReview[]
  goals: MyDayGoalSet
  availability: {
    mojoPerformance: boolean
    dialerPerformance?: boolean
    agentStats: boolean
    appointments: boolean
    habits: boolean
  }
}

export interface BuildMyDayInput {
  month: string
  range: MyDayDateRange
  now: Date
  stats: MyDayAgentStat[]
  performance: MyDayPerformanceRow[]
  dialerPerformance?: MyDayNativeDialerPerformanceRow[]
  leads: MyDayLead[]
  activities: MyDayActivity[]
  tasks: MyDayActivity[]
  appointments: MyDayAppointment[]
  goals: MyDayGoalSet
  availability: MyDayData['availability']
}

const STAGE_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  qualifying: 1,
  qualified: 2,
  appointment_set: 3,
  appt_set: 3,
  offer_made: 4,
  negotiations: 4,
  under_contract: 5,
  contract_signed: 5,
  closed_won: 6,
  closed: 6,
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: MY_DAY_TIME_ZONE, weekday: 'short' })
const DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: MY_DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function dateKey(value: string | Date): string | null {
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  return DATE_KEY.format(parsed)
}

function isWithinRange(value: string | null | undefined, range: Pick<MyDayDateRange, 'from' | 'to'>): boolean {
  const key = value ? dateKey(value) : null
  return Boolean(key && key >= range.from && key <= range.to)
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-15T12:00:00Z`))
}

function percentage(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

function stageFromActivity(activity: MyDayActivity): string {
  const metadata = activity.metadata ?? {}
  return text(metadata.new_station) || text(metadata.to_stage) || text(metadata.station) || text(metadata.stage)
}

function activityAssignedToCasey(activity: MyDayActivity): boolean {
  const metadata = activity.metadata ?? {}
  const owner = text(metadata.assigned_to) || text(metadata.assignedTo) || activity.agent || ''
  return owner.toLowerCase().includes('casey')
}

function stageEntries(
  input: BuildMyDayInput,
  threshold: number,
  range: Pick<MyDayDateRange, 'from' | 'to'> = input.range,
): Map<string, string> {
  const entries = new Map<string, string>()
  for (const activity of input.activities) {
    if (!activity.lead_id || !isWithinRange(activity.created_at, range)) continue
    const activityType = activity.activity_type.toLowerCase()
    const stage = stageFromActivity(activity)
    const rank = STAGE_RANK[stage] ?? -1
    const directMatch = threshold === 3 && activityType === 'appointment'
      || threshold === 4 && activityType === 'offer'
    if ((rank >= threshold || directMatch) && !entries.has(activity.lead_id)) {
      entries.set(activity.lead_id, activity.created_at)
    }
  }

  // Some historical rows predate stage-change events. The lead update is an
  // explicit recorded fallback; it preserves the month without inventing a
  // date and is replaced automatically whenever a stage event exists.
  for (const lead of input.leads) {
    const rank = STAGE_RANK[(lead.station || '').toLowerCase()] ?? -1
    const recordedAt = lead.updated_at || lead.created_at
    if (rank >= threshold && isWithinRange(recordedAt, range) && !entries.has(lead.id)) {
      entries.set(lead.id, recordedAt)
    }
  }
  return entries
}

function weekDateKeys(input: BuildMyDayInput): string[] {
  const monday = new Date(`${startOfMyDayWeek(input.range.to)}T12:00:00Z`)
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(monday)
    date.setUTCDate(monday.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

function requiredPerformanceDates(range: MyDayDateRange, now: Date): string[] {
  const today = dateKey(now)
  if (!today) return []
  if (range.from > today) return []
  const end = range.to > today ? today : range.to
  const cursor = new Date(`${range.from}T12:00:00Z`)
  const final = new Date(`${end}T12:00:00Z`)
  const dates: string[] = []
  while (cursor <= final) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function valuesByDay(entries: Iterable<string>, days: string[]): number[] {
  const counts = new Map(days.map((day) => [day, 0]))
  for (const value of entries) {
    const key = dateKey(value)
    if (key && counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return days.map((day) => counts.get(day) ?? 0)
}

function total(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null
}

function readHabit(metadata: Record<string, unknown> | null, keys: string[]): number | null {
  const nested = record(metadata?.daily_habits) ?? record(metadata?.dailyHabits)
  for (const key of keys) {
    const value = metadata?.[key] ?? nested?.[key]
    if (typeof value === 'boolean') return value ? 100 : 0
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed))
  }
  return null
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  return Math.round(present.reduce((sum, value) => sum + value, 0) / present.length)
}

function workdaysInRange(range: Pick<MyDayDateRange, 'from' | 'to'>): number {
  let count = 0
  const cursor = new Date(`${range.from}T12:00:00Z`)
  const end = new Date(`${range.to}T12:00:00Z`)
  while (cursor <= end) {
    const weekday = cursor.getUTCDay()
    if (weekday >= 1 && weekday <= 5) count += 1
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}

function taskStatus(activity: MyDayActivity): string {
  return text(activity.metadata?.status).toLowerCase() || 'pending'
}

function taskDueAt(activity: MyDayActivity): string | null {
  return text(activity.metadata?.due_date) || text(activity.metadata?.scheduled_at) || null
}

function taskTitle(activity: MyDayActivity): string {
  return text(activity.metadata?.title) || activity.description || 'Task'
}

function taskType(activity: MyDayActivity): string {
  return text(activity.metadata?.task_type).toLowerCase() || activity.activity_type.toLowerCase()
}

function priority(value: string | null | undefined): MyDayQueueItem['priority'] {
  const normalized = (value || '').toLowerCase()
  if (['hot', 'high', 'critical', 'urgent'].includes(normalized)) return 'High'
  if (['low', 'cold'].includes(normalized)) return 'Low'
  return 'Medium'
}

function nextActionForTask(activity: MyDayActivity, phone: string | null): MyDayQueueItem['action'] {
  const type = taskType(activity)
  const channel = text(activity.metadata?.channel).toLowerCase()
  if (channel === 'sms' || type.includes('sms') || type.includes('text')) return 'SMS'
  if (phone && (type.includes('call') || type === 'callback' || type === 'follow_up')) return 'Call'
  return 'Open'
}

function commitmentIcon(type: string): string {
  if (type.includes('appointment')) return 'event'
  if (type.includes('meeting')) return 'groups'
  if (type.includes('call') || type === 'callback') return 'call'
  return 'task_alt'
}

function callReviewScore(metadata: Record<string, unknown> | null): number | null {
  const value = metadata?.ai_score ?? metadata?.call_score ?? metadata?.quality_score
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null
}

function callReviewReason(activity: MyDayActivity): string {
  return text(activity.metadata?.review_reason)
    || text(activity.metadata?.flag_reason)
    || text(activity.metadata?.coaching_theme)
    || 'Recent recorded call'
}

export function buildMyDay(input: BuildMyDayInput): MyDayData {
  const stats = input.stats.filter((row) => row.date >= input.range.from && row.date <= input.range.to)
  const performanceRows = input.performance.filter((row) => row.metric_date >= input.range.from && row.metric_date <= input.range.to)
  const performanceByDate = new Map(input.performance.map((row) => [row.metric_date, row]))
  const requiredDates = requiredPerformanceDates(input.range, input.now)
  const mojoPerformanceStatus: MyDayData['performance']['status'] = !input.availability.mojoPerformance
    ? 'unavailable'
    : requiredDates.length > 0 && requiredDates.every((day) => performanceByDate.has(day))
      ? 'available'
      : performanceRows.length > 0 ? 'partial' : 'unavailable'
  // Mojo daily totals come only from the provider KPI snapshot. Canonical Mojo
  // events remain contact evidence and must not be counted again here.
  const allNativeDialerActivities = input.activities.filter((activity) => {
    if (activity.activity_type.toLowerCase() !== 'call') return false
    const source = text(activity.metadata?.source).toLowerCase()
    const disposition = text(activity.metadata?.disposition)
    if (source === 'mojo_call_event') return false
    if (!(activity.agent || '').toLowerCase().includes('casey')) return false
    return Boolean(disposition)
  })
  const nativeDialerActivities = allNativeDialerActivities.filter((activity) => isWithinRange(activity.created_at, input.range))
  const nativePerformanceRows = (input.dialerPerformance ?? []).filter((row) => row.metric_date >= input.range.from && row.metric_date <= input.range.to)
  const nativePerformanceByDate = new Map((input.dialerPerformance ?? []).map((row) => [row.metric_date, row]))
  const hasNativePerformance = input.availability.dialerPerformance === true
  const isMeaningfulActivity = (activity: MyDayActivity) => {
    const outcome = text(activity.metadata?.outcome).toLowerCase()
    return ['callback_scheduled', 'meaningful_conversation', 'appointment_set', 'not_interested', 'already_sold', 'listed'].includes(outcome)
      || isReachedDisposition(text(activity.metadata?.disposition))
  }
  const hasProviderPerformance = mojoPerformanceStatus === 'available'
  const legacyNativeCalls = input.dialerPerformance === undefined ? nativeDialerActivities.length : 0
  const legacyNativeContacts = input.dialerPerformance === undefined ? nativeDialerActivities.filter(isMeaningfulActivity).length : 0
  const nativeCalls = nativePerformanceRows.reduce((sum, row) => sum + number(row.calls), 0) + legacyNativeCalls
  const nativeContacts = nativePerformanceRows.reduce((sum, row) => sum + number(row.contacts), 0) + legacyNativeContacts
  const calls = hasProviderPerformance || hasNativePerformance
    ? (hasProviderPerformance ? performanceRows.reduce((sum, row) => sum + number(row.calls), 0) : 0) + nativeCalls
    : null
  const contacts = hasProviderPerformance || hasNativePerformance
    ? (hasProviderPerformance ? performanceRows.reduce((sum, row) => sum + number(row.contacts), 0) : 0) + nativeContacts
    : null
  const leadEntries = new Map(input.leads
    .filter((lead) => (lead.assigned_agent || '').toLowerCase().includes('casey') && isWithinRange(lead.created_at, input.range))
    .map((lead) => [lead.id, lead.created_at]))
  const opportunityEntries = stageEntries(input, 2)
  const appointmentEntries = stageEntries(input, 3)
  const offerEntries = stageEntries(input, 4)
  const contractEntries = stageEntries(input, 5)
  const opportunityCount = opportunityEntries.size
  const leadCount = leadEntries.size
  const appointmentCount = appointmentEntries.size
  const offerCount = offerEntries.size
  const contractCount = contractEntries.size

  const rawFunnel: Array<Omit<MyDayMetric, 'conversion'> & { denominator: number | null }> = [
    { key: 'calls', label: 'Calls', value: calls, denominator: null, icon: 'call', tone: 'blue' },
    { key: 'contacts', label: 'Contacts', value: contacts, denominator: calls, icon: 'forum', tone: 'violet' },
    { key: 'leads', label: 'Leads', value: leadCount, denominator: contacts, icon: 'person_add', tone: 'coral' },
    { key: 'opportunities', label: 'Opportunities', value: opportunityCount, denominator: leadCount, icon: 'person_search', tone: 'coral' },
    { key: 'appointments', label: 'Appointments Set', value: appointmentCount, denominator: opportunityCount, icon: 'event', tone: 'sky' },
    { key: 'offers', label: 'Offers Made', value: offerCount, denominator: appointmentCount, icon: 'sell', tone: 'green' },
    { key: 'contracts', label: 'Under Contract', value: contractCount, denominator: offerCount, icon: 'description', tone: 'indigo' },
  ]
  const funnel = rawFunnel.map(({ denominator, ...metric }) => ({
    ...metric,
    conversion: metric.key === 'calls' ? null : percentage(metric.value, denominator),
  }))

  const days = weekDateKeys(input)
  const weekRange = { from: days[0], to: days.at(-1)! }
  const today = dateKey(input.now)
  const weeklyNativeDialerActivities = allNativeDialerActivities.filter((activity) => isWithinRange(activity.created_at, weekRange))
  const legacyNativeCallsByDay = valuesByDay(weeklyNativeDialerActivities.map((activity) => activity.created_at), days)
  const legacyNativeConversationsByDay = valuesByDay(weeklyNativeDialerActivities.filter(isMeaningfulActivity).map((activity) => activity.created_at), days)
  const nativeCallsByDay = days.map((day, index) => number(nativePerformanceByDate.get(day)?.calls) + (input.dialerPerformance === undefined ? legacyNativeCallsByDay[index] : 0))
  const nativeConversationsByDay = days.map((day, index) => number(nativePerformanceByDate.get(day)?.contacts) + (input.dialerPerformance === undefined ? legacyNativeConversationsByDay[index] : 0))
  const weeklyLeadEntries = new Map(input.leads
    .filter((lead) => (lead.assigned_agent || '').toLowerCase().includes('casey') && isWithinRange(lead.created_at, weekRange))
    .map((lead) => [lead.id, lead.created_at]))
  const weeklyOpportunityEntries = stageEntries(input, 2, weekRange)
  const weeklyAppointmentEntries = stageEntries(input, 3, weekRange)
  const weeklyOfferEntries = stageEntries(input, 4, weekRange)
  const weeklyContractEntries = stageEntries(input, 5, weekRange)
  const providerDayValue = (day: string, field: 'calls' | 'contacts', nativeValue: number): number | null => {
    if (!today || day > today) return null
    const row = performanceByDate.get(day)
    if (row) return number(row[field]) + nativeValue
    return hasNativePerformance ? nativeValue : null
  }
  const weeklyRowValues: MyDayWeeklyRow[] = [
    {
      key: 'calls', label: 'Calls', icon: 'call', tone: 'blue',
      days: days.map((day, index) => providerDayValue(day, 'calls', nativeCallsByDay[index])), total: null,
    },
    {
      key: 'contacts', label: 'Contacts', icon: 'forum', tone: 'violet',
      days: days.map((day, index) => providerDayValue(day, 'contacts', nativeConversationsByDay[index])), total: null,
    },
    { key: 'leads', label: 'Leads', icon: 'person_add', tone: 'coral', days: valuesByDay(weeklyLeadEntries.values(), days), total: null },
    { key: 'opportunities', label: 'Opportunities', icon: 'person_search', tone: 'coral', days: valuesByDay(weeklyOpportunityEntries.values(), days), total: null },
    { key: 'appointments', label: 'Appointments Set', icon: 'event', tone: 'sky', days: valuesByDay(weeklyAppointmentEntries.values(), days), total: null },
    { key: 'offers', label: 'Offers Made', icon: 'sell', tone: 'green', days: valuesByDay(weeklyOfferEntries.values(), days), total: null },
    { key: 'contracts', label: 'Under Contract', icon: 'description', tone: 'indigo', days: valuesByDay(weeklyContractEntries.values(), days), total: null },
  ]
  const weeklyRows = weeklyRowValues.map((row) => ({ ...row, total: total(row.days) }))

  const followupsCompleted = stats.reduce((sum, row) => sum + number(row.followups_completed), 0)
  const followupsMissed = stats.reduce((sum, row) => sum + number(row.followups_missed), 0)
  const callingTarget = input.goals.dailyCalls ? input.goals.dailyCalls * workdaysInRange(input.range) : null
  const habits: MyDayHabit[] = [
    { key: 'vision', label: 'Review Vision', value: average(stats.map((row) => readHabit(row.metadata, ['review_vision', 'reviewVision']))) },
    { key: 'objections', label: 'Objection Practice', value: average(stats.map((row) => readHabit(row.metadata, ['objection_practice', 'objections_handling', 'objectionsHandling']))) },
    { key: 'followup', label: 'Follow-Up', value: followupsCompleted + followupsMissed > 0 ? Math.round((followupsCompleted / (followupsCompleted + followupsMissed)) * 100) : null },
    { key: 'calling', label: 'Calling Minimum', value: calls !== null && callingTarget ? Math.min(100, Math.round((calls / callingTarget) * 100)) : null },
  ]

  const leadsById = new Map(input.leads.map((lead) => [lead.id, lead]))
  const callReviews = input.activities
    .filter((activity) => {
      if (activity.activity_type.toLowerCase() !== 'call' || !activity.lead_id) return false
      return Boolean(playableRecordingUrl(activity.metadata))
        && readRecordingReview(activity.metadata).outcome === 'unreviewed'
        && readCallReviewWorkflow(activity.metadata).status !== 'completed'
    })
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 3)
    .map((activity): MyDayCallReview => ({
      id: activity.id,
      leadId: activity.lead_id!,
      leadName: leadsById.get(activity.lead_id!)?.full_name?.trim() || 'Unknown seller',
      happenedAt: activity.created_at,
      reason: callReviewReason(activity),
      aiScore: callReviewScore(activity.metadata),
      status: readCallReviewWorkflow(activity.metadata).status === 'submitted' ? 'submitted' : 'available',
      href: `/call-review?activity=${activity.id}`,
    }))
  const nowTime = input.now.getTime()
  const openTasks = input.tasks.filter((task) => {
    const status = taskStatus(task)
    return activityAssignedToCasey(task) && !['completed', 'done', 'cancelled', 'waived'].includes(status)
  })
  const queue = openTasks
    .map((task): MyDayQueueItem => {
      const lead = task.lead_id ? leadsById.get(task.lead_id) : null
      const metadataPriority = text(task.metadata?.priority)
      return {
        id: `task:${task.id}`,
        taskId: task.id,
        leadId: task.lead_id,
        leadName: lead?.full_name?.trim() || taskTitle(task),
        property: lead?.property_address?.trim() || lead?.city?.trim() || 'No property linked',
        phone: lead?.phone || null,
        stage: lead?.station ? stageLabel(lead.station) : 'Task',
        source: lead?.source ? formatLeadSource(lead.source) : 'CRM',
        priority: priority(metadataPriority || lead?.priority),
        action: nextActionForTask(task, lead?.phone || null),
        dueAt: taskDueAt(task),
      }
    })
    .sort((left, right) => {
      const priorityRank = { High: 0, Medium: 1, Low: 2 }
      const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority]
      if (priorityDifference !== 0) return priorityDifference
      return (left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER)
        - (right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER)
    })
    .slice(0, 7)

  const taskCommitments: MyDayCommitment[] = openTasks.flatMap((task) => {
    const dueAt = taskDueAt(task)
    if (!dueAt) return []
    const dueTime = new Date(dueAt).getTime()
    if (!Number.isFinite(dueTime) || dueTime < nowTime || dueTime > nowTime + 14 * 86_400_000) return []
    const lead = task.lead_id ? leadsById.get(task.lead_id) : null
    return [{
      id: `task:${task.id}`,
      title: taskTitle(task),
      detail: lead?.full_name || lead?.property_address || 'CRM task',
      dueAt,
      icon: commitmentIcon(taskType(task)),
      href: task.lead_id ? `/leads/${task.lead_id}` : '/tasks',
    }]
  })
  const appointmentCommitments: MyDayCommitment[] = input.appointments.flatMap((appointment) => {
    if (!appointment.scheduled_at || !appointment.assigned_to?.toLowerCase().includes('casey')) return []
    const dueTime = new Date(appointment.scheduled_at).getTime()
    if (!Number.isFinite(dueTime) || dueTime < nowTime || dueTime > nowTime + 14 * 86_400_000) return []
    const lead = appointment.lead_id ? leadsById.get(appointment.lead_id) : null
    return [{
      id: `appointment:${appointment.id}`,
      title: appointment.type?.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase()) || 'Seller Appointment',
      detail: lead?.full_name || appointment.address || 'Seller appointment',
      dueAt: appointment.scheduled_at,
      icon: 'event',
      href: appointment.lead_id ? `/leads/${appointment.lead_id}` : '/calendar?department=acquisitions',
    }]
  })
  const commitments = [...appointmentCommitments, ...taskCommitments]
    .filter((item, index, rows) => rows.findIndex((candidate) => candidate.dueAt === item.dueAt && candidate.detail === item.detail) === index)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime())
    .slice(0, 4)

  const sourceFetchedAt = performanceRows
    .map((row) => row.source_fetched_at)
    .filter((value) => Number.isFinite(new Date(value).getTime()))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null
  const nativeDialingSeconds = nativePerformanceRows.reduce((sum, row) => sum + number(row.dialing_seconds), 0)
  const dialingSeconds = hasProviderPerformance || hasNativePerformance
    ? (hasProviderPerformance ? performanceRows.reduce((sum, row) => sum + number(row.dialing_seconds), 0) : 0) + nativeDialingSeconds
    : null
  const performanceSource: MyDayData['performance']['source'] = hasNativePerformance
    ? (performanceRows.length > 0 ? 'combined' : 'native_dialer')
    : 'mojo'
  const performanceStatus: MyDayData['performance']['status'] = hasProviderPerformance
    ? 'available'
    : hasNativePerformance ? 'partial' : mojoPerformanceStatus

  return {
    month: input.month,
    monthLabel: monthLabel(input.month),
    range: input.range,
    generatedAt: input.now.toISOString(),
    agent: { name: 'Casey', initials: 'C' },
    performance: {
      source: performanceSource,
      status: performanceStatus,
      dialingSeconds,
      sourceFetchedAt,
    },
    funnel,
    week: {
      start: days[0],
      end: days.at(-1)!,
      dayLabels: days.map((day) => WEEKDAY.format(new Date(`${day}T12:00:00Z`))),
      rows: weeklyRows,
    },
    habits,
    commitments,
    queue,
    callReviews,
    goals: input.goals,
    availability: { ...input.availability, habits: habits.some((habit) => habit.value !== null) },
  }
}

export function normalizeMyDayMonth(value: string | null | undefined, now = new Date()): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value
  return dateKey(now)?.slice(0, 7) || now.toISOString().slice(0, 7)
}
