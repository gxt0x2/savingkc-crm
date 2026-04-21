'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Buyer } from '@/types/dispo'

interface BuyerFilters {
  page?: number
  limit?: number
  status?: string
  tier?: string
  search?: string
  tag?: string
}

export function useBuyers(filters: BuyerFilters = {}) {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.limit) params.set('limit', String(filters.limit))
  if (filters.status) params.set('status', filters.status)
  if (filters.tier) params.set('tier', filters.tier)
  if (filters.search) params.set('search', filters.search)
  if (filters.tag) params.set('tag', filters.tag)

  return useQuery({
    queryKey: ['buyers', filters],
    queryFn: async () => {
      const res = await fetch(`/api/buyers?${params}`)
      if (!res.ok) throw new Error('Failed to fetch buyers')
      return res.json() as Promise<{ buyers: Buyer[]; total: number }>
    },
    staleTime: 60_000,
  })
}

export function useBuyer(id: string | null) {
  return useQuery({
    queryKey: ['buyer', id],
    queryFn: async () => {
      const res = await fetch(`/api/buyers/${id}`)
      if (!res.ok) throw new Error('Failed to fetch buyer')
      return res.json() as Promise<{ buyer: Buyer }>
    },
    enabled: !!id,
  })
}

export function useCreateBuyer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<Buyer>) => {
      const res = await fetch('/api/buyers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create buyer')
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buyers'] }),
  })
}

export function useUpdateBuyer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { id: string } & Partial<Buyer>) => {
      const res = await fetch('/api/buyers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update buyer')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buyers'] })
      qc.invalidateQueries({ queryKey: ['buyer'] })
    },
  })
}

export function useDeleteBuyers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/buyers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('Failed to delete buyers')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buyers'] }),
  })
}

export function useImportBuyers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/buyers/import', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Import failed')
      }
      return res.json() as Promise<{ imported: number; skipped: number; errors: string[] }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buyers'] }),
  })
}
