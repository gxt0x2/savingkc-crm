'use client'

import { useQuery } from '@tanstack/react-query'

// Mock Ari responses (will be replaced with direct MCP calls when Ari is connected)
const mockResponses: Record<string, unknown> = {
  'sit-rep': {
    status: 'operational',
    activeCalls: 0,
    pendingTasks: 12,
    hotLeads: 5,
    summary: 'Pipeline healthy. 5 hot leads need follow-up today.',
  },
  briefing: {
    followUps: 8,
    appointments: 3,
    optimalCallWindow: '10:00 AM - 12:00 PM',
    priority: 'Focus on negotiations stage - 3 deals close to signing.',
  },
  'call-stats': {
    totalCalls: 1500,
    avgDialTime: 2.4,
    contactRate: 10.0,
    leadsGenerated: 15,
    appointmentsSet: 4,
  },
}

export function useAriSitRep() {
  return useQuery({
    queryKey: ['ari', 'sit-rep'],
    queryFn: async () => mockResponses['sit-rep'],
    refetchInterval: 5 * 60 * 1000,
  })
}

export function useAriBriefing() {
  return useQuery({
    queryKey: ['ari', 'briefing'],
    queryFn: async () => mockResponses['briefing'],
    refetchInterval: 15 * 60 * 1000,
  })
}

export function useAriCallStats() {
  return useQuery({
    queryKey: ['ari', 'call-stats'],
    queryFn: async () => mockResponses['call-stats'],
    refetchInterval: 60 * 1000,
  })
}
