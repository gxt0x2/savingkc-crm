'use client'

import { useQuery } from '@tanstack/react-query'
import { useSupabase } from './use-supabase'
import type { Task } from '@/types'

export function useTasks() {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, contact:contacts(*)')
        .order('due_date', { ascending: true })
      if (error) throw error
      return data as Task[]
    },
  })
}
