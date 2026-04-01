'use client'

import { useQuery } from '@tanstack/react-query'
import { useSupabase } from './use-supabase'
import type { Task, Contact, DealStage } from '@/types'

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
  metadata: {
    title?: string
    task_type?: string
    due_date?: string
    assigned_to?: string
    status?: string
    property_address?: string
  } | null
  created_at: string
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

export function useCalendarTasks() {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['calendar-tasks'],
    queryFn: async () => {
      // Fetch task-type activities from lead_activities
      const { data: activities, error: activitiesError } = await supabase
        .from('lead_activities')
        .select('*')
        .in('activity_type', ['task', 'appointment', 'follow_up', 'callback', 'send_offer'])
        .order('created_at', { ascending: true })

      if (activitiesError) throw activitiesError

      const taskRows = activities as TaskActivityRow[]

      // Fetch all leads referenced in tasks
      const leadIds = taskRows
        .map(t => t.lead_id)
        .filter((id): id is string => id !== null)

      const uniqueLeadIds = Array.from(new Set(leadIds))

      let leadsMap: Record<string, Contact> = {}
      if (uniqueLeadIds.length > 0) {
        const { data: leads, error: leadsError } = await supabase
          .from('leads')
          .select('id, full_name, phone, email, property_address, city, state, zip, station, created_at')
          .in('id', uniqueLeadIds)

        if (leadsError) throw leadsError

        leadsMap = (leads as LeadRow[]).reduce((acc, row) => {
          acc[row.id] = rowToContact(row)
          return acc
        }, {} as Record<string, Contact>)
      }

      // Map activities to Task type
      const tasks: Task[] = taskRows.map(row => {
        const meta = row.metadata || {}
        const contact = row.lead_id ? leadsMap[row.lead_id] : undefined

        return {
          id: row.id,
          type: (meta.task_type || row.activity_type) as any,
          title: meta.title || row.description || 'Untitled Task',
          description: row.description,
          contact_id: row.lead_id,
          deal_id: null,
          property_address: meta.property_address || contact?.address || null,
          due_date: meta.due_date || null,
          assigned_to: meta.assigned_to || null,
          status: (meta.status || 'pending') as any,
          created_at: row.created_at,
          contact,
        }
      })

      // Sort by due date
      tasks.sort((a, b) => {
        const dateA = a.due_date ? new Date(a.due_date).getTime() : 0
        const dateB = b.due_date ? new Date(b.due_date).getTime() : 0
        return dateA - dateB
      })

      return tasks
    },
  })
}
