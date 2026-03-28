import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type AuditType =
  | 'missing_disposition'
  | 'stage_timeout'
  | 'overdue_task'
  | 'requirement_violation'
  | 'duplicate'
  | 'orphan'
  | 'workflow_compliance'
  | 'data_freshness'

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface AuditFinding {
  audit_type: AuditType
  severity: AuditSeverity
  description: string
  lead_id?: string
  agent_id?: string
  metadata?: any
}

/**
 * AUD-01: Continuous Data Quality Checks
 * Scans for data integrity issues and generates audit findings + Ari briefing events
 */
export async function runDataQualityAudit(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = []

  // 1. Calls with no disposition
  const missingDispositions = await findCallsWithoutDisposition()
  findings.push(...missingDispositions)

  // 2. Leads stuck past stage timeout
  const stuckLeads = await findLeadsPastStageSLA()
  findings.push(...stuckLeads)

  // 3. Overdue follow-up tasks
  const overdueTasks = await findOverdueTasks()
  findings.push(...overdueTasks)

  // 4. Leads advanced without meeting requirements
  const requirementViolations = await findRequirementViolations()
  findings.push(...requirementViolations)

  // 5. Duplicate leads
  const duplicates = await findDuplicateLeads()
  findings.push(...duplicates)

  // 6. Orphaned records
  const orphans = await findOrphanedRecords()
  findings.push(...orphans)

  // Save all findings to database
  if (findings.length > 0) {
    const { error } = await supabase.from('ari_audit_findings').insert(
      findings.map((f) => ({
        audit_type: f.audit_type,
        severity: f.severity,
        description: f.description,
        lead_id: f.lead_id,
        agent_id: f.agent_id,
        metadata: f.metadata,
      }))
    )

    if (error) {
      console.error('Error saving audit findings:', error)
    }

    // Generate Ari briefing events for critical/high severity findings
    await createBriefingEventsForFindings(findings)
  }

  return findings
}

async function findCallsWithoutDisposition(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = []

  // Get calls from lead_activities
  const { data: calls, error } = await supabase
    .from('lead_activities')
    .select('id, lead_id, agent, metadata, created_at')
    .eq('type', 'call')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours

  if (error || !calls) return findings

  // Check for missing dispositions
  const missingDisposition = calls.filter((c) => !c.metadata?.outcome && !c.metadata?.disposition)

  if (missingDisposition.length > 0) {
    // Group by agent
    const byAgent = missingDisposition.reduce((acc, call) => {
      const agent = call.agent || 'Unknown'
      acc[agent] = (acc[agent] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    for (const [agent, count] of Object.entries(byAgent)) {
      findings.push({
        audit_type: 'missing_disposition',
        severity: count > 10 ? 'high' : 'medium',
        description: `${agent} logged ${count} calls in the last 24 hours without dispositions. Every call needs an outcome.`,
        agent_id: agent,
        metadata: { missing_count: count, timeframe: '24h' },
      })
    }
  }

  return findings
}

async function findLeadsPastStageSLA(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = []

  // Stage timeout thresholds (days)
  const timeouts: Record<string, number> = {
    new: 3,
    contacted: 7,
    qualifying: 14,
    appt_set: 3,
    negotiations: 14,
  }

  for (const [stage, days] of Object.entries(timeouts)) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const { data: stuckLeads, error } = await supabase
      .from('leads')
      .select('id, full_name, station, updated_at')
      .eq('station', stage)
      .lt('updated_at', cutoffDate.toISOString())

    if (error || !stuckLeads || stuckLeads.length === 0) continue

    for (const lead of stuckLeads) {
      const daysStuck = Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / (24 * 60 * 60 * 1000))

      findings.push({
        audit_type: 'stage_timeout',
        severity: daysStuck > days * 2 ? 'critical' : 'high',
        description: `${lead.full_name} has been in ${stage} for ${daysStuck} days (SLA: ${days} days). Time to advance or move to nurture.`,
        lead_id: lead.id,
        metadata: { stage, days_stuck: daysStuck, sla_days: days },
      })
    }
  }

  return findings
}

async function findOverdueTasks(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = []

  const { data: tasks, error } = await supabase
    .from('lead_activities')
    .select('id, lead_id, agent, metadata, created_at')
    .eq('type', 'task')
    .lt('metadata->>due_date', new Date().toISOString())
    .neq('metadata->>status', 'completed')

  if (error || !tasks || tasks.length === 0) return findings

  // Group by agent
  const byAgent = tasks.reduce((acc, task) => {
    const agent = task.metadata?.assigned_to || task.agent || 'Unknown'
    acc[agent] = (acc[agent] || []).concat(task)
    return acc
  }, {} as Record<string, any[]>)

  for (const [agent, agentTasks] of Object.entries(byAgent)) {
    findings.push({
      audit_type: 'overdue_task',
      severity: agentTasks.length > 5 ? 'high' : 'medium',
      description: `${agent} has ${agentTasks.length} overdue follow-ups. Knock these out before starting new cold calls.`,
      agent_id: agent,
      metadata: { overdue_count: agentTasks.length, task_ids: agentTasks.map((t) => t.id) },
    })
  }

  return findings
}

async function findRequirementViolations(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = []

  // Leads in "qualifying" (Stage 3) must have all 4 pillars
  const { data: qualifiedLeads, error } = await supabase
    .from('leads')
    .select('id, full_name, four_pillars')
    .eq('station', 'qualifying')

  if (error || !qualifiedLeads) return findings

  for (const lead of qualifiedLeads) {
    const pillars = lead.four_pillars || {}
    const missingPillars = []

    if (!pillars.TIMELINE) missingPillars.push('Timeline')
    if (!pillars.CONDITION) missingPillars.push('Condition')
    if (!pillars.MOTIVATION) missingPillars.push('Motivation')
    if (!pillars.PRICE) missingPillars.push('Price')

    if (missingPillars.length > 0) {
      findings.push({
        audit_type: 'requirement_violation',
        severity: 'high',
        description: `${lead.full_name} is marked Qualified but missing: ${missingPillars.join(', ')}. Complete pillars before advancing.`,
        lead_id: lead.id,
        metadata: { missing_pillars: missingPillars },
      })
    }
  }

  // Leads in "appt_set" (Stage 4: Offer Made) must have deal math
  const { data: offerLeads } = await supabase
    .from('leads')
    .select('id, full_name, deal_math')
    .eq('station', 'appt_set')

  if (offerLeads) {
    for (const lead of offerLeads) {
      if (!lead.deal_math || !lead.deal_math.mao) {
        findings.push({
          audit_type: 'requirement_violation',
          severity: 'critical',
          description: `${lead.full_name} is in Offer Made but has no deal math. Complete the calculator before sending offers.`,
          lead_id: lead.id,
          metadata: { missing: 'deal_math' },
        })
      }
    }
  }

  return findings
}

async function findDuplicateLeads(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = []

  // Find duplicate phone numbers
  const { data: phoneGroups, error: phoneError } = await supabase.rpc('find_duplicate_phones', {})

  if (!phoneError && phoneGroups) {
    for (const group of phoneGroups) {
      if (group.count > 1) {
        findings.push({
          audit_type: 'duplicate',
          severity: 'medium',
          description: `Phone number ${group.phone} appears on ${group.count} lead records. Review and merge duplicates.`,
          metadata: { phone: group.phone, count: group.count },
        })
      }
    }
  }

  // Find duplicate addresses
  const { data: addressGroups } = await supabase.rpc('find_duplicate_addresses', {})

  if (addressGroups) {
    for (const group of addressGroups) {
      if (group.count > 1) {
        findings.push({
          audit_type: 'duplicate',
          severity: 'medium',
          description: `Address "${group.property_address}" appears on ${group.count} lead records. Review and merge duplicates.`,
          metadata: { property_address: group.property_address, count: group.count },
        })
      }
    }
  }

  return findings
}

async function findOrphanedRecords(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = []

  // Leads with no stage
  const { data: noStage, error } = await supabase
    .from('leads')
    .select('id, full_name')
    .or('station.is.null,station.eq.')

  if (!error && noStage && noStage.length > 0) {
    findings.push({
      audit_type: 'orphan',
      severity: 'high',
      description: `${noStage.length} leads have no stage assigned. Every lead must exist in exactly one stage.`,
      metadata: { count: noStage.length, lead_ids: noStage.map((l) => l.id) },
    })
  }

  // Tasks with no assignee
  const { data: unassignedTasks } = await supabase
    .from('lead_activities')
    .select('id, lead_id, description')
    .eq('type', 'task')
    .or('agent.is.null,metadata->>assigned_to.is.null')

  if (unassignedTasks && unassignedTasks.length > 0) {
    findings.push({
      audit_type: 'orphan',
      severity: 'medium',
      description: `${unassignedTasks.length} tasks have no assignee. Assign all tasks to ensure accountability.`,
      metadata: { count: unassignedTasks.length },
    })
  }

  return findings
}

/**
 * Creates Ari briefing events for critical/high severity findings
 */
async function createBriefingEventsForFindings(findings: AuditFinding[]) {
  const briefingEvents = findings
    .filter((f) => f.severity === 'critical' || f.severity === 'high')
    .map((f) => ({
      event_type: 'audit_finding',
      priority: f.severity,
      title: `Quality Alert: ${f.audit_type.replace(/_/g, ' ')}`,
      description: f.description,
      lead_id: f.lead_id,
      action_url: f.lead_id ? `/leads/${f.lead_id}` : null,
      metadata: { audit_type: f.audit_type, ...f.metadata },
    }))

  if (briefingEvents.length > 0) {
    await supabase.from('ari_briefing_events').insert(briefingEvents)
  }
}

/**
 * AUD-04: System Accuracy Verification
 * Checks system worker health and generates alerts for degraded/down workers
 */
export async function verifySystemHealth() {
  const { data: workers, error } = await supabase
    .from('system_workers')
    .select('id, name, type, status, check_interval_minutes, last_run, last_success')

  if (error || !workers) return

  const now = new Date()

  for (const worker of workers) {
    if (!worker.check_interval_minutes) continue // Webhooks don't have intervals

    const expectedIntervalMs = worker.check_interval_minutes * 60 * 1000
    const lastRunMs = worker.last_run ? now.getTime() - new Date(worker.last_run).getTime() : null
    const lastSuccessMs = worker.last_success ? now.getTime() - new Date(worker.last_success).getTime() : null

    let status = 'unknown'
    let severity: AuditSeverity = 'low'
    let description = ''

    if (lastSuccessMs && lastSuccessMs > expectedIntervalMs * 4) {
      status = 'down'
      severity = 'critical'
      description = `${worker.name} hasn't run successfully in ${Math.floor(lastSuccessMs / 60000)} minutes (expected every ${worker.check_interval_minutes} min). Check connection.`
    } else if (lastSuccessMs && lastSuccessMs > expectedIntervalMs * 2) {
      status = 'degraded'
      severity = 'high'
      description = `${worker.name} hasn't run in ${Math.floor(lastSuccessMs / 60000)} minutes (expected every ${worker.check_interval_minutes} min). Investigating.`
    }

    if (status === 'down' || status === 'degraded') {
      // Create audit finding
      await supabase.from('ari_audit_findings').insert({
        audit_type: 'data_freshness',
        severity,
        description,
        metadata: {
          worker_name: worker.name,
          worker_type: worker.type,
          last_run: worker.last_run,
          last_success: worker.last_success,
          expected_interval_minutes: worker.check_interval_minutes,
        },
      })

      // Create Ari briefing event
      await supabase.from('ari_briefing_events').insert({
        event_type: 'system_health',
        priority: severity,
        title: `System Worker ${status === 'down' ? 'Down' : 'Degraded'}`,
        description,
        metadata: { worker_name: worker.name, worker_status: status },
      })
    }
  }
}

/**
 * AUD-06: Coaching Nudges
 * Detects patterns and creates coaching nudges for agents
 */
export async function generateCoachingNudges(agentId: string) {
  const today = new Date().toISOString().split('T')[0]

  // Get agent stats for last 2 days
  const { data: stats, error } = await supabase
    .from('agent_daily_stats')
    .select('*')
    .eq('agent_id', agentId)
    .gte('date', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
    .order('date', { ascending: false })

  if (error || !stats || stats.length < 2) return

  const [latest, previous] = stats

  // Check disposition rate (should be 100%)
  if (latest.calls_made > 0) {
    const dispositionRate = (latest.dispositions_logged / latest.calls_made) * 100
    if (dispositionRate < 80 && previous.dispositions_logged / previous.calls_made < 0.8) {
      await supabase.from('ari_nudges').insert({
        agent_id: agentId,
        nudge_type: 'disposition_rate_low',
        priority: 'high',
        message: `Your disposition logging has been at ${Math.round(dispositionRate)}% for 2 days. Every call needs an outcome — it's how Ari knows what to do next.`,
      })
      // Ignore duplicate constraint errors (max 1 per type per day)
    }
  }

  // Check meaningful conversation rate (should be 5-10%)
  if (latest.calls_made > 0) {
    const convRate = (latest.meaningful_conversations / latest.calls_made) * 100
    if (convRate < 5) {
      await supabase.from('ari_nudges').insert({
        agent_id: agentId,
        nudge_type: 'conversation_rate_low',
        priority: 'medium',
        message: `Your connect rate is ${Math.round(convRate)}% this week. Consider prioritizing mobile numbers, calling during different hours, or trying tax-delinquent leads first.`,
      })
    }
  }

  // Check follow-up completion rate (should be 95%+)
  const totalFollowups = latest.followups_completed + latest.followups_missed
  if (totalFollowups > 0) {
    const completionRate = (latest.followups_completed / totalFollowups) * 100
    if (completionRate < 80) {
      await supabase.from('ari_nudges').insert({
        agent_id: agentId,
        nudge_type: 'followup_rate_low',
        priority: 'high',
        message: `You have ${latest.followups_missed} overdue follow-ups. Knock those out before starting new cold calls — warm leads cool fast.`,
      })
    }
  }

  // Check for specific leads with 3+ missed follow-ups
  const { data: missedLeads } = await supabase
    .from('lead_activities')
    .select('lead_id, leads!inner(full_name)')
    .eq('type', 'task')
    .eq('metadata->>assigned_to', agentId)
    .eq('metadata->>status', 'missed')
    .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())

  if (missedLeads) {
    const leadCounts = missedLeads.reduce((acc: Record<string, { name: string; count: number }>, item: any) => {
      if (!acc[item.lead_id]) {
        acc[item.lead_id] = { name: item.leads?.full_name || 'Unknown', count: 0 }
      }
      acc[item.lead_id].count++
      return acc
    }, {})

    for (const [leadId, info] of Object.entries(leadCounts)) {
      if (info.count >= 3) {
        await supabase.from('ari_nudges').insert({
          agent_id: agentId,
          nudge_type: 'specific_lead_missed',
          priority: 'high',
          message: `${info.name} has been missed ${info.count} times. Either connect or move to Dead/Nurture — don't let leads sit in limbo.`,
        })
      }
    }
  }
}
