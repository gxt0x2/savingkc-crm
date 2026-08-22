export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { createWorkItem, listWorkItems, normalizeWorkItemKind, WorkItemError, type WorkItem } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isNonRealRecord } from '@/lib/real-data'
import type { Contact, DealStage, Task } from '@/types'

interface LeadRow {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  station: string | null
  created_at: string
}

interface TcFileRow {
  id: string
  lead_id: string
  dispo_deal_id: string | null
  file_number: string | null
  status: string
  emd_due_at: string | null
  closing_scheduled_at: string | null
  next_action: string | null
  created_at: string
  updated_at: string
}

interface TcTaskRow {
  id: string
  tc_file_id: string
  task_type: string
  label: string
  status: 'open' | 'done' | 'waived' | 'blocked'
  due_at: string | null
  assigned_to: string | null
  notes: string | null
  created_at: string
}

interface DispoDealRow {
  id: string
  lead_id: string
  stage: string
  close_date: string | null
  assignment_fee: number | null
  updated_at: string
}

type CalendarDepartment = 'acquisitions' | 'dispositions' | 'tc'

function normalizeDepartment(value: string | null): CalendarDepartment {
  if (value === 'dispositions' || value === 'tc') return value
  return 'acquisitions'
}

function rowToContact(row: LeadRow): Contact {
  const parts = (row.full_name || 'Unknown').split(' ')
  return {
    id: row.id,
    first_name: parts[0] || 'Unknown',
    last_name: parts.slice(1).join(' ') || '',
    email: row.email,
    phone: row.phone,
    address: row.property_address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    personality_type: null,
    lead_score: null,
    lead_owner: null,
    smart_tags: [],
    current_stage: (row.station as DealStage) || null,
    created_at: row.created_at,
    updated_at: row.created_at,
  }
}

async function loadLeadMap(db: ReturnType<typeof supabaseAdmin>, leadIds: string[]) {
  const uniqueLeadIds = Array.from(new Set(leadIds.filter(Boolean)))
  if (uniqueLeadIds.length === 0) return {}

  const { data: leads, error } = await db
    .from('leads')
    .select('id, full_name, phone, email, property_address, city, state, zip, station, created_at')
    .in('id', uniqueLeadIds)

  if (error) throw new Error(error.message)

  return ((leads || []) as LeadRow[]).reduce((acc, row) => {
    acc[row.id] = rowToContact(row)
    return acc
  }, {} as Record<string, Contact>)
}

function workItemToTask(item: WorkItem, leadsMap: Record<string, Contact>): Task {
  const contact = item.leadId ? leadsMap[item.leadId] : undefined
  return {
    id: item.key,
    type: item.kind as Task['type'],
    title: item.title,
    description: item.description,
    contact_id: item.leadId,
    deal_id: item.tcFileId,
    property_address: contact?.address || null,
    due_date: item.dueAt,
    assigned_to: item.assignedTo,
    status: item.status === 'completed' ? 'completed' : 'pending',
    created_at: item.sourceCreatedAt,
    contact,
  }
}

function calendarStatus(dueDate: string | null, completed = false): Task['status'] {
  if (completed) return 'completed'
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'overdue'
  return 'pending'
}

function labelForLead(contact?: Contact) {
  return contact?.address || [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Dispo file'
}

function isRealContact(contact?: Contact) {
  return !isNonRealRecord(
    contact?.first_name,
    contact?.last_name,
    contact?.address,
    contact?.city,
  )
}

async function loadTcCalendarTasks(db: ReturnType<typeof supabaseAdmin>): Promise<Task[]> {
  const tasks: Task[] = []

  const [tcFilesRes, tcTasksRes] = await Promise.all([
    db
      .from('tc_files')
      .select('id, lead_id, dispo_deal_id, file_number, status, emd_due_at, closing_scheduled_at, next_action, created_at, updated_at')
      .not('dispo_deal_id', 'is', null)
      .neq('status', 'cancelled')
      .limit(300),
    db
      .from('tc_tasks')
      .select('id, tc_file_id, task_type, label, status, due_at, assigned_to, notes, created_at')
      .not('due_at', 'is', null)
      .in('status', ['open', 'blocked'])
      .limit(300),
  ])

  if (tcFilesRes.error) throw new Error(tcFilesRes.error.message)
  if (tcTasksRes.error) throw new Error(tcTasksRes.error.message)

  const tcFiles = (tcFilesRes.data || []) as TcFileRow[]
  const tcTaskRows = (tcTasksRes.data || []) as TcTaskRow[]

  const taskFileIds = Array.from(new Set(tcTaskRows.map((task) => task.tc_file_id)))
  let taskFiles: TcFileRow[] = []
  if (taskFileIds.length > 0) {
    const { data, error } = await db
      .from('tc_files')
      .select('id, lead_id, dispo_deal_id, file_number, status, emd_due_at, closing_scheduled_at, next_action, created_at, updated_at')
      .not('dispo_deal_id', 'is', null)
      .in('id', taskFileIds)

    if (error) throw new Error(error.message)
    taskFiles = (data || []) as TcFileRow[]
  }

  const filesById = [...tcFiles, ...taskFiles].reduce((acc, file) => {
    acc[file.id] = file
    return acc
  }, {} as Record<string, TcFileRow>)

  const leadsMap = await loadLeadMap(db, [
    ...tcFiles.map((file) => file.lead_id),
    ...taskFiles.map((file) => file.lead_id),
  ])

  const realFileIds = new Set(
    [...tcFiles, ...taskFiles]
      .filter((file) => isRealContact(leadsMap[file.lead_id]))
      .map((file) => file.id)
  )

  for (const file of tcFiles.filter((tcFile) => realFileIds.has(tcFile.id))) {
    const contact = leadsMap[file.lead_id]
    const propertyLabel = labelForLead(contact)

    if (file.closing_scheduled_at) {
      tasks.push({
        id: `tc-file-${file.id}-closing`,
        type: 'appointment',
        title: `Closing: ${propertyLabel}`,
        description: file.next_action || 'Closing scheduled',
        contact_id: file.lead_id,
        deal_id: file.id,
        property_address: contact?.address || null,
        due_date: file.closing_scheduled_at,
        assigned_to: null,
        status: calendarStatus(file.closing_scheduled_at),
        created_at: file.created_at,
        contact,
      })
    }

    if (file.emd_due_at && file.status !== 'closed') {
      tasks.push({
        id: `tc-file-${file.id}-emd`,
        type: 'follow_up',
        title: `EMD due: ${propertyLabel}`,
        description: file.file_number ? `File ${file.file_number}` : 'Earnest money due',
        contact_id: file.lead_id,
        deal_id: file.id,
        property_address: contact?.address || null,
        due_date: file.emd_due_at,
        assigned_to: null,
        status: calendarStatus(file.emd_due_at),
        created_at: file.created_at,
        contact,
      })
    }
  }

  for (const task of tcTaskRows.filter((tcTask) => realFileIds.has(tcTask.tc_file_id))) {
    const file = filesById[task.tc_file_id]
    const contact = file ? leadsMap[file.lead_id] : undefined

    tasks.push({
      id: `tc-task-${task.id}`,
      type: 'task',
      title: `TC: ${task.label}`,
      description: task.notes,
      contact_id: file?.lead_id ?? null,
      deal_id: task.tc_file_id,
      property_address: contact?.address || null,
      due_date: task.due_at,
      assigned_to: task.assigned_to,
      status: calendarStatus(task.due_at),
      created_at: task.created_at,
      contact,
    })
  }

  return tasks
}

async function loadDispositionCalendarTasks(db: ReturnType<typeof supabaseAdmin>): Promise<Task[]> {
  const { data, error } = await db
    .from('dispo_deals')
    .select('id, lead_id, stage, close_date, assignment_fee, updated_at')
    .not('close_date', 'is', null)
    .neq('stage', 'dead')
    .limit(300)

  if (error) throw new Error(error.message)

  const dispoDeals = (data || []) as DispoDealRow[]
  const leadsMap = await loadLeadMap(db, dispoDeals.map((deal) => deal.lead_id))

  return dispoDeals.map((deal) => {
    const contact = leadsMap[deal.lead_id]
    return {
      id: `dispo-deal-${deal.id}-close-date`,
      type: 'appointment',
      title: `Close target: ${labelForLead(contact)}`,
      description: deal.assignment_fee ? `Assignment fee: $${Number(deal.assignment_fee).toLocaleString()}` : `Deal stage: ${deal.stage}`,
      contact_id: deal.lead_id,
      deal_id: deal.id,
      property_address: contact?.address || null,
      due_date: deal.close_date,
      assigned_to: null,
      status: calendarStatus(deal.close_date),
      created_at: deal.updated_at,
      contact,
    }
  })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const department = normalizeDepartment(searchParams.get('department'))
    const db = supabaseAdmin()
    const items = await listWorkItems({
      department,
      statuses: ['pending', 'blocked', 'completed'],
      limit: 500,
    })
    const leadsMap = await loadLeadMap(db, items.flatMap((item) => item.leadId ? [item.leadId] : []))
    const activityTasks = items.map((item) => workItemToTask(item, leadsMap))

    const departmentTasks = department === 'tc'
      ? (await loadTcCalendarTasks(db)).filter((task) => task.id.startsWith('tc-file-'))
      : department === 'dispositions'
        ? await loadDispositionCalendarTasks(db)
        : []
    const tasks = [...activityTasks, ...departmentTasks]
      .sort((a, b) => {
        const dateA = a.due_date ? new Date(a.due_date).getTime() : 0
        const dateB = b.due_date ? new Date(b.due_date).getTime() : 0
        return dateA - dateB
      })

    return NextResponse.json({ success: true, department, tasks })
  } catch (err) {
    console.error('[calendar/tasks] unexpected error:', err)
    return NextResponse.json({ success: false, tasks: [], error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const authenticatedActor = await resolveAuthenticatedActor()
    if (!authenticatedActor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const title = typeof body.title === 'string' ? body.title.trim() : ''

    if (!title) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 })
    }

    const dueDateValue = body.dueDate ? new Date(body.dueDate) : null
    if (dueDateValue && Number.isNaN(dueDateValue.getTime())) {
      return NextResponse.json({ success: false, error: 'Due date is invalid' }, { status: 400 })
    }
    const dueDate = dueDateValue?.toISOString() || null
    const department = normalizeDepartment(typeof body.department === 'string' ? body.department : null)
    const assignment = resolveTaskAssignee(body.assignedTo, authenticatedActor.name, { defaultToActor: true })
    if (!assignment.authorized || !assignment.assignedTo) {
      return NextResponse.json({ success: false, error: 'Task assignee is not authorized' }, { status: 403 })
    }
    const assignedTo = assignment.assignedTo

    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
      || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '')
      || crypto.randomUUID()
    const result = await createWorkItem({
      actor: authenticatedActor.name,
      idempotencyKey,
      leadId: typeof body.leadId === 'string' ? body.leadId : null,
      kind: normalizeWorkItemKind(body.taskType),
      title,
      notes: typeof body.notes === 'string' ? body.notes.trim() : null,
      dueAt: dueDate,
      assignedTo,
      department,
      role: typeof body.role === 'string' ? body.role : 'setter',
      priority: 'normal',
      primaryNextAction: body.primaryNextAction === true,
    })

    return NextResponse.json({ success: true, created: result.created, taskId: result.workItem.key })
  } catch (err) {
    if (err instanceof WorkItemError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'invalid' ? 400 : 503
      return NextResponse.json({ success: false, error: err.message }, { status })
    }
    console.error('[calendar/tasks] create unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
