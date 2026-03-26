'use client'

import { useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ViewToggle, type CalendarView } from '@/components/calendar/view-toggle'
import { MonthView } from '@/components/calendar/month-view'
import { WeekView } from '@/components/calendar/week-view'
import { AgendaView } from '@/components/calendar/agenda-view'
import { AriBriefingPopup } from '@/components/ari/ari-briefing-popup'
import type { Task } from '@/types'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Mock tasks for calendar demo
function getMockTasks(): Task[] {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()

  return [
    {
      id: 't1',
      type: 'follow_up',
      title: '123 Oak St',
      description: 'Lead: Michael Henderson',
      contact_id: 'c1',
      deal_id: 'd1',
      property_address: '123 Oak St, Kansas City, MO',
      due_date: new Date(y, m, d - 8, 9, 15).toISOString(),
      assigned_to: 'JD',
      status: 'overdue',
      created_at: new Date(y, m, 1).toISOString(),
      contact: { first_name: 'Michael', last_name: 'Henderson', id: 'c1', email: null, phone: null, address: '123 Oak St', city: 'Kansas City', state: 'MO', zip: '64110', personality_type: null, lead_score: null, lead_owner: null, smart_tags: [], current_stage: 'contacted', created_at: '', updated_at: '' },
    },
    {
      id: 't2',
      type: 'review',
      title: 'KC North Area Analysis',
      description: 'Market Report: Q3 Update',
      contact_id: null,
      deal_id: null,
      property_address: null,
      due_date: new Date(y, m, d - 5, 17, 0).toISOString(),
      assigned_to: 'JD',
      status: 'overdue',
      created_at: new Date(y, m, 1).toISOString(),
    },
    {
      id: 't3',
      type: 'appointment',
      title: 'Miller Estate Residence',
      description: 'Owner: Sarah Miller - On-site Walkthrough',
      contact_id: 'c2',
      deal_id: 'd2',
      property_address: 'Miller Estate Residence',
      due_date: new Date(y, m, d, 10, 30).toISOString(),
      assigned_to: 'AM',
      status: 'pending',
      created_at: new Date(y, m, 1).toISOString(),
      contact: { first_name: 'Sarah', last_name: 'Miller', id: 'c2', email: null, phone: null, address: null, city: null, state: null, zip: null, personality_type: null, lead_score: null, lead_owner: null, smart_tags: [], current_stage: 'appt_set', created_at: '', updated_at: '' },
    },
    {
      id: 't4',
      type: 'follow_up',
      title: '782 Bluebell Ct',
      description: 'Contact: David Wilson - Negotiating Offer',
      contact_id: 'c3',
      deal_id: 'd3',
      property_address: '782 Bluebell Ct',
      due_date: new Date(y, m, d, 14, 15).toISOString(),
      assigned_to: 'JD',
      status: 'pending',
      created_at: new Date(y, m, 1).toISOString(),
      contact: { first_name: 'David', last_name: 'Wilson', id: 'c3', email: null, phone: null, address: null, city: null, state: null, zip: null, personality_type: null, lead_score: null, lead_owner: null, smart_tags: [], current_stage: 'negotiations', created_at: '', updated_at: '' },
    },
    {
      id: 't5',
      type: 'follow_up',
      title: 'Follow-up Call (3)',
      description: null,
      contact_id: null,
      deal_id: null,
      property_address: null,
      due_date: new Date(y, m, d, 13, 0).toISOString(),
      assigned_to: 'JD',
      status: 'pending',
      created_at: new Date(y, m, 1).toISOString(),
    },
    {
      id: 't6',
      type: 'send_offer',
      title: '450 Maple Ave',
      description: 'Lead: Jennifer Lopez (Owner)',
      contact_id: 'c4',
      deal_id: 'd4',
      property_address: '450 Maple Ave',
      due_date: new Date(y, m, d + 1, 9, 0).toISOString(),
      assigned_to: 'JD',
      status: 'pending',
      created_at: new Date(y, m, 1).toISOString(),
      contact: { first_name: 'Jennifer', last_name: 'Lopez', id: 'c4', email: null, phone: null, address: null, city: null, state: null, zip: null, personality_type: null, lead_score: null, lead_owner: null, smart_tags: [], current_stage: 'qualifying', created_at: '', updated_at: '' },
    },
    {
      id: 't7',
      type: 'task',
      title: 'Update Pipeline: KC South',
      description: 'Internal Team Review',
      contact_id: null,
      deal_id: null,
      property_address: null,
      due_date: new Date(y, m, d + 1, 11, 0).toISOString(),
      assigned_to: 'TH',
      status: 'pending',
      created_at: new Date(y, m, 1).toISOString(),
    },
    {
      id: 't8',
      type: 'review',
      title: 'Review Comps: KC North',
      description: null,
      contact_id: null,
      deal_id: null,
      property_address: null,
      due_date: new Date(y, m, d + 6, 11, 0).toISOString(),
      assigned_to: 'TS',
      status: 'pending',
      created_at: new Date(y, m, 1).toISOString(),
    },
    {
      id: 't9',
      type: 'send_offer',
      title: 'Smith Residence',
      description: 'Property Acquisition Package',
      contact_id: 'c5',
      deal_id: 'd5',
      property_address: 'Smith Residence',
      due_date: new Date(y, m, d + 9, 14, 0).toISOString(),
      assigned_to: 'JD',
      status: 'pending',
      created_at: new Date(y, m, 1).toISOString(),
    },
    {
      id: 't10',
      type: 'follow_up',
      title: 'Follow-up Call',
      description: null,
      contact_id: null,
      deal_id: null,
      property_address: null,
      due_date: new Date(y, m, d + 15, 10, 0).toISOString(),
      assigned_to: 'JD',
      status: 'pending',
      created_at: new Date(y, m, 1).toISOString(),
    },
  ]
}

function CalendarContent() {
  const searchParams = useSearchParams()
  const viewParam = (searchParams.get('view') || 'month') as CalendarView

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const tasks = getMockTasks()

  const handlePrevMonth = useCallback(() => {
    setMonth((prev) => {
      if (prev === 0) {
        setYear((y) => y - 1)
        return 11
      }
      return prev - 1
    })
  }, [])

  const handleNextMonth = useCallback(() => {
    setMonth((prev) => {
      if (prev === 11) {
        setYear((y) => y + 1)
        return 0
      }
      return prev + 1
    })
  }, [])

  return (
    <>
      <ViewToggle
        currentView={viewParam}
        currentMonth={MONTH_NAMES[month]}
        currentYear={year}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
      />

      <main className="px-8 pb-32">
        {viewParam === 'month' && (
          <MonthView year={year} month={month} tasks={tasks} />
        )}
        {viewParam === 'week' && (
          <WeekView year={year} month={month} tasks={tasks} />
        )}
        {viewParam === 'agenda' && (
          <AgendaView tasks={tasks} />
        )}
        {viewParam === 'day' && (
          <WeekView year={year} month={month} tasks={tasks} />
        )}
      </main>

      {viewParam === 'month' && (
        <AriBriefingPopup followUpCount={3} optimalWindow="2:00 PM - 5:00 PM CST" />
      )}
    </>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="p-8 text-on-surface-variant">Loading calendar...</div>}>
      <CalendarContent />
    </Suspense>
  )
}
