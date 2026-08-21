'use client'

import { useQuery } from '@tanstack/react-query'

import type { TaskWorklistCounts, TaskWorklistPage } from '@/lib/server/task-worklist'
import type { Contact, DealStage, Task } from '@/types'

export type TaskWorklistQuery = {
  department?: 'acquisitions' | 'dispositions' | 'tc'
  view?: 'all' | 'due_today' | 'overdue' | 'upcoming' | 'completed'
  status?: 'all' | 'active' | 'completed'
  assignee?: string
  due?: 'any' | 'no_due' | 'seven_days' | 'thirty_days'
  type?: 'any' | 'follow_up' | 'callback' | 'appointment' | 'research' | 'offer' | 'general'
  query?: string
  sort?: 'due_asc' | 'due_desc' | 'newest' | 'title'
  limit?: number
  cursor?: string | null
}

export type TaskWorklistResult = {
  tasks: Task[]
  counts: TaskWorklistCounts
  pageInfo: TaskWorklistPage['pageInfo']
  serverNow: string
}

function contactFromPage(value: TaskWorklistPage['items'][number]['contact']): Contact | undefined {
  if (!value) return undefined
  const parts = (value.fullName || 'Unknown').trim().split(/\s+/)
  return {
    id: value.id,
    first_name: parts[0] || 'Unknown',
    last_name: parts.slice(1).join(' '),
    email: value.email,
    phone: value.phone,
    address: value.propertyAddress,
    city: value.city,
    state: value.state,
    zip: value.zip,
    personality_type: null,
    lead_score: null,
    lead_owner: null,
    smart_tags: [],
    current_stage: value.station as DealStage | null,
    created_at: value.createdAt || '',
    updated_at: value.createdAt || '',
  }
}

function taskFromPage(item: TaskWorklistPage['items'][number]): Task {
  const contact = contactFromPage(item.contact)
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
    version: item.version,
    contact,
  }
}

export function useTaskWorklist(input: TaskWorklistQuery) {
  return useQuery({
    queryKey: ['task-worklist', input],
    queryFn: async (): Promise<TaskWorklistResult> => {
      const params = new URLSearchParams()
      const entries: Array<[string, string | number | null | undefined]> = [
        ['department', input.department], ['view', input.view], ['status', input.status], ['assignee', input.assignee],
        ['due', input.due], ['type', input.type], ['q', input.query], ['sort', input.sort], ['limit', input.limit], ['cursor', input.cursor],
      ]
      for (const [key, value] of entries) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
      const response = await fetch(`/api/tasks/worklist?${params}`, { cache: 'no-store' })
      const payload = await response.json() as TaskWorklistPage & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Tasks could not be loaded.')
      return { tasks: payload.items.map(taskFromPage), counts: payload.counts, pageInfo: payload.pageInfo, serverNow: payload.serverNow }
    },
  })
}
