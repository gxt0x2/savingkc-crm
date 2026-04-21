'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { DealBroadcast, BroadcastRecipient, BuyerMatch } from '@/types/dispo'

export function useBroadcasts(leadId?: string) {
  const params = new URLSearchParams()
  if (leadId) params.set('lead_id', leadId)

  return useQuery({
    queryKey: ['broadcasts', leadId],
    queryFn: async () => {
      const res = await fetch(`/api/broadcasts?${params}`)
      if (!res.ok) throw new Error('Failed to fetch broadcasts')
      return res.json() as Promise<{ broadcasts: DealBroadcast[] }>
    },
    staleTime: 30_000,
  })
}

export function useBroadcast(id: string | null) {
  return useQuery({
    queryKey: ['broadcast', id],
    queryFn: async () => {
      const res = await fetch(`/api/broadcasts/${id}`)
      if (!res.ok) throw new Error('Failed to fetch broadcast')
      return res.json() as Promise<{ broadcast: DealBroadcast; recipients: BroadcastRecipient[] }>
    },
    enabled: !!id,
  })
}

export function useCreateBroadcast() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { lead_id: string; broadcast_type?: string }) => {
      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create broadcast')
      }
      return res.json() as Promise<{ broadcast: DealBroadcast; matches: BuyerMatch[] }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcasts'] }),
  })
}

export function useSendBroadcast() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      broadcast_id: string
      sms_body?: string
      email_subject?: string
      email_body?: string
    }) => {
      const res = await fetch('/api/broadcasts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to send broadcast')
      }
      return res.json() as Promise<{ sent_sms: number; sent_email: number }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['broadcasts'] })
      qc.invalidateQueries({ queryKey: ['broadcast'] })
    },
  })
}
