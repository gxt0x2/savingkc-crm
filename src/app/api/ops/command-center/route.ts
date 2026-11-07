import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

type Row = Record<string, unknown>
type Severity = 'critical' | 'warning' | 'attention' | 'ok'

interface QueryIssue {
  area: string
  message: string
}

interface Metric {
  label: string
  value: string
  detail: string
  tone: Severity
}

function text(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function numberValue(row: Row, key: string): number {
  const value = row[key]
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function metadata(row: Row): Row {
  const value = row.metadata
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function timestamp(row: Row, key: string): number {
  const value = text(row, key)
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function startOfToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function isWithin(row: Row, key: string, hours: number): boolean {
  const ts = timestamp(row, key)
  return ts > 0 && Date.now() - ts <= hours * 60 * 60 * 1000
}

function compactMoney(value: number): string {
  if (!value) return '$0'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${Math.round(value).toLocaleString()}`
}

async function rows(label: string, promise: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>, issues: QueryIssue[]) {
  const { data, error } = await promise
  if (error) {
    issues.push({ area: label, message: error.message })
    return []
  }
  return data || []
}

export async function GET() {
  const db = supabaseAdmin()
  const issues: QueryIssue[] = []
  const today = startOfToday()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    leads,
    activities,
    smsLogs,
    workers,
    tasks,
    appointments,
    notifications,
    phoneVerifications,
    siteChecks,
  ] = await Promise.all([
    rows('leads', db.from('leads').select('*').order('updated_at', { ascending: false }).limit(1000), issues),
    rows('lead_activities', db.from('lead_activities').select('*').order('created_at', { ascending: false }).limit(700), issues),
    rows('sms_delivery_log', db.from('sms_delivery_log').select('*').gte('created_at', sevenDaysAgo).order('created_at', { ascending: false }).limit(250), issues),
    rows('system_workers', db.from('system_workers').select('*').order('status', { ascending: true }).order('name', { ascending: true }).limit(100), issues),
    rows('tasks', db.from('tasks').select('*').in('status', ['pending', 'overdue']).order('due_date', { ascending: true }).limit(100), issues),
    rows('appointments', db.from('appointments').select('*').gte('scheduled_at', new Date(today).toISOString()).order('scheduled_at', { ascending: true }).limit(100), issues),
    rows('notifications', db.from('notifications').select('*').order('created_at', { ascending: false }).limit(50), issues),
    rows('phone_verifications', db.from('phone_verifications').select('*').order('updated_at', { ascending: false }).limit(200), issues),
    rows('site_health_checks', db.from('site_health_checks').select('*').order('checked_at', { ascending: false }).limit(20), issues),
  ])

  const activeLeads = leads.filter((lead) => !['dead', 'closed'].includes((text(lead, 'station') || '').toLowerCase()))
  const hotLeads = activeLeads.filter((lead) => ['hot', 'high'].includes((text(lead, 'priority') || '').toLowerCase()))
  const newToday = leads.filter((lead) => timestamp(lead, 'created_at') >= today)
  const staleLeads = activeLeads.filter((lead) => {
    const ts = timestamp(lead, 'updated_at') || timestamp(lead, 'created_at')
    return ts > 0 && Date.now() - ts > 7 * 24 * 60 * 60 * 1000
  })
  const dealStages = new Set(['qualifying', 'qualified', 'appt_set', 'appointment', 'negotiations', 'offer_made', 'under_contract', 'contract_signed'])
  const activeDeals = activeLeads.filter((lead) => dealStages.has((text(lead, 'station') || '').toLowerCase()))
  const assignmentAtRisk = activeDeals.reduce((sum, lead) => sum + numberValue(lead, 'assignment_fee'), 0)
  const openOffers = activeLeads.filter((lead) => ['negotiations', 'offer_made'].includes((text(lead, 'station') || '').toLowerCase()))
  const underContract = activeLeads.filter((lead) => ['under_contract', 'contract_signed'].includes((text(lead, 'station') || '').toLowerCase()))

  const activities24 = activities.filter((activity) => isWithin(activity, 'created_at', 24))
  const inboundSms24 = activities24.filter((activity) => {
    const meta = metadata(activity)
    return text(activity, 'activity_type') === 'sms' && ['inbound', 'received'].includes(String(meta.direction || '').toLowerCase())
  })
  const outboundSms24 = activities24.filter((activity) => {
    const meta = metadata(activity)
    return text(activity, 'activity_type') === 'sms' && ['outbound', 'sent'].includes(String(meta.direction || '').toLowerCase())
  })
  const calls24 = activities24.filter((activity) => text(activity, 'activity_type') === 'call')
  const recordings24 = activities24.filter((activity) => {
    const meta = metadata(activity)
    return Boolean(meta.recordingUrl || meta.recording_url || meta.RecordingUrl || meta.recordingSid)
  })
  const unmatchedComms = activities.filter((activity) => {
    const leadId = activity.lead_id
    return !leadId && ['call', 'sms', 'voicemail'].includes(text(activity, 'activity_type') || '')
  })
  const failedSms = smsLogs.filter((log) => log.success === false)
  const badNumberLeads = leads.filter((lead) => {
    const result = `${text(lead, 'call_result') || ''} ${text(lead, 'notes') || ''}`.toLowerCase()
    return ['bad_number', 'wrong_number', 'disconnected', 'dnc', 'do not call'].some((flag) => result.includes(flag))
  })

  const dueTaskRows = tasks.map((task) => ({
    id: text(task, 'id') || crypto.randomUUID(),
    title: text(task, 'title') || text(task, 'description') || 'Task',
    owner: text(task, 'assigned_to') || 'Unassigned',
    dueAt: text(task, 'due_date'),
    status: text(task, 'status') || 'pending',
    source: 'tasks',
    leadId: text(task, 'lead_id'),
  }))
  const activityTaskRows = activities
    .filter((activity) => text(activity, 'activity_type') === 'task')
    .map((activity) => {
      const meta = metadata(activity)
      return {
        id: text(activity, 'id') || crypto.randomUUID(),
        title: text(activity, 'description') || 'Task',
        owner: text(activity, 'agent') || text(meta, 'assigned_to') || 'Unassigned',
        dueAt: text(meta, 'due_date') || text(meta, 'scheduled_at'),
        status: text(meta, 'status') || 'pending',
        source: 'lead_activities',
        leadId: text(activity, 'lead_id'),
      }
    })
  const humanQueue = [...dueTaskRows, ...activityTaskRows]
    .filter((task) => !['completed', 'done'].includes(task.status.toLowerCase()))
    .sort((a, b) => {
      const aTs = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER
      const bTs = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER
      return aTs - bTs
    })
    .slice(0, 10)

  const todayAppointments = appointments.filter((appt) => {
    const ts = timestamp(appt, 'scheduled_at')
    return ts >= today && ts < today + 24 * 60 * 60 * 1000
  })
  const openNotifications = notifications.filter((notification) => notification.is_read === false)
  const workersWithoutRunProof = workers.filter((worker) => {
    const status = text(worker, 'status')
    return status === 'healthy' && !text(worker, 'last_run') && !text(worker, 'last_success')
  })
  const unhealthyWorkers = workers.filter((worker) => ['down', 'degraded', 'unknown'].includes(text(worker, 'status') || 'unknown'))

  const hasPhoneVerifier = !issues.some((issue) => issue.area === 'phone_verifications')
  const hasSiteMonitor = !issues.some((issue) => issue.area === 'site_health_checks')

  const metrics: Metric[] = [
    {
      label: 'Revenue At Risk',
      value: compactMoney(assignmentAtRisk),
      detail: `${activeDeals.length} active deal-stage leads`,
      tone: activeDeals.length > 0 ? 'attention' : 'ok',
    },
    {
      label: 'Hot Leads',
      value: String(hotLeads.length),
      detail: `${newToday.length} new today`,
      tone: hotLeads.length > 0 ? 'attention' : 'ok',
    },
    {
      label: 'Appointments Today',
      value: String(todayAppointments.length),
      detail: `${appointments.length} upcoming loaded`,
      tone: todayAppointments.length > 0 ? 'attention' : 'ok',
    },
    {
      label: 'Offers / Contracts',
      value: `${openOffers.length}/${underContract.length}`,
      detail: 'open offers / under contract',
      tone: openOffers.length + underContract.length > 0 ? 'attention' : 'ok',
    },
  ]

  const exceptions = [
    {
      id: 'query-gaps',
      severity: issues.length > 0 ? 'critical' as Severity : 'ok' as Severity,
      title: 'Data / monitor gaps',
      count: issues.length,
      detail: issues.length > 0 ? issues.map((issue) => `${issue.area}: ${issue.message}`).slice(0, 3).join(' | ') : 'All command-center queries returned.',
      href: null,
    },
    {
      id: 'failed-sms',
      severity: failedSms.length > 0 ? 'critical' as Severity : 'ok' as Severity,
      title: 'Failed SMS sends',
      count: failedSms.length,
      detail: failedSms.length > 0 ? `${failedSms[0].error_message || 'Latest failure needs review'}` : 'No failed SMS in the last 7 days.',
      href: '/conversations',
    },
    {
      id: 'unmatched-comms',
      severity: unmatchedComms.length > 0 ? 'warning' as Severity : 'ok' as Severity,
      title: 'Unmatched calls/texts',
      count: unmatchedComms.length,
      detail: unmatchedComms.length > 0 ? 'Comms without a lead need identity resolution.' : 'No unmatched comms in the loaded window.',
      href: '/conversations',
    },
    {
      id: 'phone-verifier',
      severity: hasPhoneVerifier ? 'ok' as Severity : 'critical' as Severity,
      title: 'Number verifier',
      count: hasPhoneVerifier ? phoneVerifications.length : 0,
      detail: hasPhoneVerifier ? 'Phone verification table exists.' : 'phone_verifications is missing. Clean-number enforcement is not installed.',
      href: null,
    },
    {
      id: 'stale-leads',
      severity: staleLeads.length > 0 ? 'warning' as Severity : 'ok' as Severity,
      title: 'Stale active leads',
      count: staleLeads.length,
      detail: staleLeads.length > 0 ? 'Active leads untouched for 7+ days.' : 'No stale active leads in the loaded window.',
      href: '/leads',
    },
    {
      id: 'worker-proof',
      severity: workersWithoutRunProof.length > 0 ? 'warning' as Severity : 'ok' as Severity,
      title: 'Worker proof missing',
      count: workersWithoutRunProof.length,
      detail: workersWithoutRunProof.length > 0 ? 'Some workers are marked healthy without last-run proof.' : 'Workers include run evidence.',
      href: null,
    },
  ]

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    metrics,
    business: {
      activeLeads: activeLeads.length,
      totalLeadsLoaded: leads.length,
      hotLeads: hotLeads.slice(0, 6).map((lead) => ({
        id: text(lead, 'id'),
        name: text(lead, 'full_name') || 'Unknown seller',
        address: [text(lead, 'property_address'), text(lead, 'city')].filter(Boolean).join(', '),
        station: text(lead, 'station') || 'intake',
        priority: text(lead, 'priority') || 'normal',
        updatedAt: text(lead, 'updated_at') || text(lead, 'created_at'),
      })),
    },
    communications: {
      inboundSms24: inboundSms24.length,
      outboundSms24: outboundSms24.length,
      calls24: calls24.length,
      recordings24: recordings24.length,
      failedSms7d: failedSms.length,
      unmatched: unmatchedComms.length,
      latestUnmatched: unmatchedComms.slice(0, 6).map((activity) => {
        const meta = metadata(activity)
        return {
          id: text(activity, 'id'),
          type: text(activity, 'activity_type') || 'activity',
          phone: text(meta, 'from') || text(meta, 'to') || 'unknown',
          description: text(activity, 'description') || '',
          createdAt: text(activity, 'created_at'),
        }
      }),
    },
    exceptions,
    humanQueue,
    automation: {
      total: workers.length,
      unhealthy: unhealthyWorkers.length,
      missingRunProof: workersWithoutRunProof.length,
      workers: workers.map((worker) => ({
        id: text(worker, 'id') || text(worker, 'name'),
        name: text(worker, 'name') || 'Worker',
        status: text(worker, 'status') || 'unknown',
        type: text(worker, 'type') || 'worker',
        lastRun: text(worker, 'last_run'),
        lastSuccess: text(worker, 'last_success'),
        failureCount: numberValue(worker, 'failure_count_24h'),
      })),
    },
    website: {
      installed: hasSiteMonitor,
      checks: hasSiteMonitor
        ? siteChecks.slice(0, 6).map((check) => ({
            id: text(check, 'id') || text(check, 'target') || crypto.randomUUID(),
            target: text(check, 'target') || text(check, 'url') || 'Website check',
            status: text(check, 'status') || 'unknown',
            detail: text(check, 'message') || text(check, 'detail') || '',
            checkedAt: text(check, 'checked_at'),
          }))
        : [
            {
              id: 'site-monitor-missing',
              target: 'Website / domain monitor',
              status: 'missing',
              detail: 'site_health_checks is not installed. Add DNS, SSL, homepage, form-submit, and tracking checks.',
              checkedAt: null,
            },
          ],
    },
    proof: {
      openNotifications: openNotifications.length,
      badNumberLeads: badNumberLeads.length,
      loadedRows: {
        leads: leads.length,
        activities: activities.length,
        smsDeliveryLog: smsLogs.length,
        workers: workers.length,
        tasks: tasks.length,
        appointments: appointments.length,
      },
    },
    issues,
  })
}
