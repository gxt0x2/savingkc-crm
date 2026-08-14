import { formatLeadSource } from '@/lib/contact-display'
import { stageLabel } from '@/lib/utils'

export const MY_DAY_TIME_ZONE = 'America/Chicago'

export interface MyDayAgentStat {
  date: string
  calls_made: number | null
  meaningful_conversations: number | null
  followups_completed: number | null
  followups_missed: number | null
  metadata: Record<string, unknown> | null
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
  key: 'calls' | 'conversations' | 'opportunities' | 'appointments' | 'offers' | 'contracts'
  label: string
  value: number | null
  conversion: number | null
  icon: string
  tone: 'blue' | 'violet' | 'coral' | 'sky' | 'green' | 'indigo'
}

export interface MyDayWeeklyRow {
  key: 'calls' | 'conversations' | 'opportunities' | 'appointments' | 'offers' | 'contracts'
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

export interface MyDayData {
  month: string
  monthLabel: string
  generatedAt: string
  agent: { name: 'Casey'; initials: 'C' }
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
  goals: MyDayGoalSet
  availability: {
    agentStats: boolean
    appointments: boolean
    habits: boolean
  }
}

export interface BuildMyDayInput {
  month: string
  now: Date
  stats: MyDayAgentStat[]
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

function startOfMonthKey(month: string) {
  return `${month}-01`
}

function endOfMonthKey(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0, 12)).toISOString().slice(0, 10)
}

function isWithinMonth(value: string | null | undefined, month: string): boolean {
  const key = value ? dateKey(value) : null
  return Boolean(key && key >= startOfMonthKey(month) && key <= endOfMonthKey(month))
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

function stageEntries(input: BuildMyDayInput, threshold: number): Map<string, string> {
  const entries = new Map<string, string>()
  for (const activity of input.activities) {
    if (!activity.lead_id || !isWithinMonth(activity.created_at, input.month)) continue
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
    if (rank >= threshold && isWithinMonth(recordedAt, input.month) && !entries.has(lead.id)) {
      entries.set(lead.id, recordedAt)
    }
  }
  return entries
}

function weekDateKeys(input: BuildMyDayInput): string[] {
  const currentMonth = dateKey(input.now)?.slice(0, 7)
  const anchorKey = currentMonth === input.month ? dateKey(input.now)! : endOfMonthKey(input.month)
  const anchor = new Date(`${anchorKey}T12:00:00Z`)
  const day = anchor.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(anchor)
  monday.setUTCDate(anchor.getUTCDate() + mondayOffset)
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(monday)
    date.setUTCDate(monday.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
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

function workdaysInMonth(month: string): number {
  const lastDay = Number(endOfMonthKey(month).slice(-2))
  let count = 0
  for (let day = 1; day <= lastDay; day += 1) {
    const weekday = new Date(`${month}-${String(day).padStart(2, '0')}T12:00:00Z`).getUTCDay()
    if (weekday >= 1 && weekday <= 5) count += 1
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

export function buildMyDay(input: BuildMyDayInput): MyDayData {
  const stats = input.stats.filter((row) => row.date.startsWith(input.month))
  const calls = input.availability.agentStats ? stats.reduce((sum, row) => sum + number(row.calls_made), 0) : null
  const conversations = input.availability.agentStats ? stats.reduce((sum, row) => sum + number(row.meaningful_conversations), 0) : null
  const opportunityEntries = stageEntries(input, 2)
  const appointmentEntries = stageEntries(input, 3)
  const offerEntries = stageEntries(input, 4)
  const contractEntries = stageEntries(input, 5)
  const opportunityCount = opportunityEntries.size
  const appointmentCount = appointmentEntries.size
  const offerCount = offerEntries.size
  const contractCount = contractEntries.size

  const rawFunnel: Array<Omit<MyDayMetric, 'conversion'> & { denominator: number | null }> = [
    { key: 'calls', label: 'Calls', value: calls, denominator: null, icon: 'call', tone: 'blue' },
    { key: 'conversations', label: 'Meaningful Conversations', value: conversations, denominator: calls, icon: 'forum', tone: 'violet' },
    { key: 'opportunities', label: 'Opportunities', value: opportunityCount, denominator: conversations, icon: 'person_search', tone: 'coral' },
    { key: 'appointments', label: 'Appointments Set', value: appointmentCount, denominator: opportunityCount, icon: 'event', tone: 'sky' },
    { key: 'offers', label: 'Offers Made', value: offerCount, denominator: appointmentCount, icon: 'sell', tone: 'green' },
    { key: 'contracts', label: 'Under Contract', value: contractCount, denominator: offerCount, icon: 'description', tone: 'indigo' },
  ]
  const funnel = rawFunnel.map(({ denominator, ...metric }) => ({
    ...metric,
    conversion: metric.key === 'calls' ? null : percentage(metric.value, denominator),
  }))

  const days = weekDateKeys(input)
  const statsByDate = new Map(stats.map((row) => [row.date, row]))
  const weeklyRowValues: MyDayWeeklyRow[] = [
    {
      key: 'calls', label: 'Calls', icon: 'call', tone: 'blue',
      days: days.map((day) => input.availability.agentStats ? number(statsByDate.get(day)?.calls_made) : null), total: null,
    },
    {
      key: 'conversations', label: 'Meaningful Conversations', icon: 'forum', tone: 'violet',
      days: days.map((day) => input.availability.agentStats ? number(statsByDate.get(day)?.meaningful_conversations) : null), total: null,
    },
    { key: 'opportunities', label: 'Opportunities', icon: 'person_search', tone: 'coral', days: valuesByDay(opportunityEntries.values(), days), total: null },
    { key: 'appointments', label: 'Appointments Set', icon: 'event', tone: 'sky', days: valuesByDay(appointmentEntries.values(), days), total: null },
    { key: 'offers', label: 'Offers Made', icon: 'sell', tone: 'green', days: valuesByDay(offerEntries.values(), days), total: null },
    { key: 'contracts', label: 'Under Contract', icon: 'description', tone: 'indigo', days: valuesByDay(contractEntries.values(), days), total: null },
  ]
  const weeklyRows = weeklyRowValues.map((row) => ({ ...row, total: total(row.days) }))

  const followupsCompleted = stats.reduce((sum, row) => sum + number(row.followups_completed), 0)
  const followupsMissed = stats.reduce((sum, row) => sum + number(row.followups_missed), 0)
  const callingTarget = input.goals.dailyCalls ? input.goals.dailyCalls * workdaysInMonth(input.month) : null
  const habits: MyDayHabit[] = [
    { key: 'vision', label: 'Review Vision', value: average(stats.map((row) => readHabit(row.metadata, ['review_vision', 'reviewVision']))) },
    { key: 'objections', label: 'Objection Practice', value: average(stats.map((row) => readHabit(row.metadata, ['objection_practice', 'objections_handling', 'objectionsHandling']))) },
    { key: 'followup', label: 'Follow-Up', value: followupsCompleted + followupsMissed > 0 ? Math.round((followupsCompleted / (followupsCompleted + followupsMissed)) * 100) : null },
    { key: 'calling', label: 'Calling Minimum', value: calls !== null && callingTarget ? Math.min(100, Math.round((calls / callingTarget) * 100)) : null },
  ]

  const leadsById = new Map(input.leads.map((lead) => [lead.id, lead]))
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

  return {
    month: input.month,
    monthLabel: monthLabel(input.month),
    generatedAt: input.now.toISOString(),
    agent: { name: 'Casey', initials: 'C' },
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
    goals: input.goals,
    availability: { ...input.availability, habits: habits.some((habit) => habit.value !== null) },
  }
}

export function normalizeMyDayMonth(value: string | null | undefined, now = new Date()): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value
  return dateKey(now)?.slice(0, 7) || now.toISOString().slice(0, 7)
}
