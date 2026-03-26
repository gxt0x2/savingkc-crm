/**
 * ARI CRM - Financial Data Hook
 * Night 6: DSH-06, DSH-07, DSH-08
 */

import { useEffect, useState } from 'react'

export interface FinancialData {
  total: {
    revenue: number
    expenses: number
    net: number
    last_updated: string
  }
  period?: {
    period: 'week' | 'month'
    start_date: string
    revenue: number
    expenses: number
    net: number
    expenses_by_category: Record<string, number>
    comparison: {
      prev_revenue: number
      prev_expenses: number
      prev_net: number
      revenue_change: number
      expense_change: number
    }
  }
}

export function useFinancials(period?: 'week' | 'month') {
  const [data, setData] = useState<FinancialData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const url = period ? `/api/financials?period=${period}` : '/api/financials'
    fetch(url)
      .then((r) => r.json())
      .then(setData)
      .catch((err) => console.error('Failed to fetch financials:', err))
      .finally(() => setLoading(false))
  }, [period])

  return { data, loading }
}
