'use client'

import { useQuery } from '@tanstack/react-query'
import type { Task } from '@/types'

export type CalendarDepartment = 'acquisitions' | 'dispositions' | 'tc'

export function useCalendarTasks(department: CalendarDepartment = 'acquisitions') {
  return useQuery({
    queryKey: ['calendar-tasks', department],
    queryFn: async () => {
      const params = new URLSearchParams({ department })
      const res = await fetch(`/api/calendar/tasks?${params}`, { cache: 'no-store' })
      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load calendar tasks')
      }

      return (data.tasks || []) as Task[]
    },
  })
}
