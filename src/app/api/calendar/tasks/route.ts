export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
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

interface TaskActivityRow {
  id: string
  lead_id: string | null
  activity_type: string
  description: string | null
  agent: string | null
  metadata: {
    title?: string
    task_type?: string
    due_date?: string
    assigned_to?: string
    status?: string
    property_address?: string
    department?: string
  } | null
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

const DISPOSITION_STAGES = new Set(['contract_signed', 'under_contract', 'disposition', 'closed'])

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

function departmentForActivity(row: TaskActivityRow, contact?: Contact): CalendarDepartment {
  const explicit = normalizeDepartment(row.metadata?.department ?? null)
  if (row.metadata?.department) return explicit
  return contact?.current_stage && DISPOSITION_STAGES.has(contact.current_stage) ? 'dispositions' : 'acquisitions'
}

function activityToTask(row: TaskActivityRow, leadsMap: Record<string, Contact>): Task {
  const meta = row.metadata || {}
  const contact = row.lead_id ? leadsMap[row.lead_id] : undefined

  return {
    id: row.id,
    type: (meta.task_type || row.activity_type) as Task['type'],
    title: meta.title || row.description || 'Untitled Task',
    description: row.description,
    contact_id: row.lead_id,
    deal_id: null,
    property_address: meta.property_address || contact?.address || null,
    due_date: meta.due_date || null,
    assigned_to: meta.assigned_to || row.agent || null,
    status: (meta.status || 'pending') as Task['status'],
    created_at: row.created_at,
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

    const { data: activities, error: activitiesError } = await db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('activity_type', ['task', 'appointment', 'follow_up', 'callback', 'send_offer'])
      .order('created_at', { ascending: true })

    if (activitiesError) {
      console.error('[calendar/tasks] activity fetch failed:', activitiesError.message)
      return NextResponse.json({ success: false, tasks: [], error: activitiesError.message }, { status: 500 })
    }

    const taskRows = (activities || []) as TaskActivityRow[]
    const leadIds = taskRows
      .map((task) => task.lead_id)
      .filter((id): id is string => id !== null)
    const leadsMap = await loadLeadMap(db, leadIds)

    const activityTasks = taskRows
      .map((row) => ({ row, task: activityToTask(row, leadsMap) }))
      .filter(({ row, task }) => departmentForActivity(row, task.contact) === department)
      .map(({ task }) => task)

    const departmentTasks = department === 'tc'
      ? await loadTcCalendarTasks(db)
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
    const body = await req.json()
    const title = typeof body.title === 'string' ? body.title.trim() : ''

    if (!title) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 })
    }

    const dueDate = body.dueDate ? new Date(body.dueDate).toISOString() : null
    const department = normalizeDepartment(typeof body.department === 'string' ? body.department : null)

    const { data, error } = await supabaseAdmin()
      .from('lead_activities')
      .insert({
        lead_id: body.leadId || null,
        activity_type: 'task',
        description: title,
        agent: body.assignedTo || 'Casey',
        metadata: {
          task_type: body.taskType || 'follow_up',
          due_date: dueDate,
          assigned_to: body.assignedTo || 'Casey',
          role: body.role || 'setter',
          department,
          priority: 'normal',
          status: 'pending',
          notes: body.notes?.trim() || undefined,
          source: body.leadId ? 'lead_detail_task' : 'calendar_new_task',
        },
      })
      .select('id')
      .single()

    if (error) {
      console.error('[calendar/tasks] create failed:', error.message)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, taskId: data.id })
  } catch (err) {
    console.error('[calendar/tasks] create unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
