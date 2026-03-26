/**
 * ARI CRM - Financial Data API
 * Night 6: DSH-06, DSH-07, DSH-08
 *
 * GET /api/financials - Get current financial summary
 * GET /api/financials?period=week - Get weekly financial summary
 * GET /api/financials?period=month - Get monthly financial summary
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'total'

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get overall summary
    const { data: summary } = await supabase
      .from('financial_summary')
      .select('*')
      .single()

    if (!summary) {
      return NextResponse.json(
        { error: 'Financial summary not found' },
        { status: 404 }
      )
    }

    // Calculate period-specific data
    let periodData = null

    if (period === 'week' || period === 'month') {
      const now = new Date()
      let startDate: Date

      if (period === 'week') {
        // Start of current week (Monday)
        const dayOfWeek = now.getDay()
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        startDate = new Date(now)
        startDate.setDate(now.getDate() + diff)
        startDate.setHours(0, 0, 0, 0)
      } else {
        // Start of current month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      }

      const startDateStr = startDate.toISOString().split('T')[0]

      // Get revenue for period
      const { data: revenueData } = await supabase
        .from('revenue_transactions')
        .select('amount')
        .gte('date', startDateStr)

      const periodRevenue = revenueData?.reduce(
        (sum, r) => sum + Number(r.amount),
        0
      ) || 0

      // Get expenses for period
      const { data: expenseData } = await supabase
        .from('expense_transactions')
        .select('amount, category')
        .gte('date', startDateStr)

      const periodExpenses = expenseData?.reduce(
        (sum, e) => sum + Number(e.amount),
        0
      ) || 0

      // Expense breakdown by category
      const expensesByCategory = expenseData?.reduce(
        (acc, e) => {
          const cat = e.category
          acc[cat] = (acc[cat] || 0) + Number(e.amount)
          return acc
        },
        {} as Record<string, number>
      )

      // Compare to previous period
      let prevStartDate: Date
      if (period === 'week') {
        prevStartDate = new Date(startDate)
        prevStartDate.setDate(prevStartDate.getDate() - 7)
      } else {
        prevStartDate = new Date(
          startDate.getFullYear(),
          startDate.getMonth() - 1,
          1
        )
      }

      const prevEndDate = new Date(startDate)
      prevEndDate.setDate(prevEndDate.getDate() - 1)

      const { data: prevRevenueData } = await supabase
        .from('revenue_transactions')
        .select('amount')
        .gte('date', prevStartDate.toISOString().split('T')[0])
        .lte('date', prevEndDate.toISOString().split('T')[0])

      const { data: prevExpenseData } = await supabase
        .from('expense_transactions')
        .select('amount')
        .gte('date', prevStartDate.toISOString().split('T')[0])
        .lte('date', prevEndDate.toISOString().split('T')[0])

      const prevRevenue = prevRevenueData?.reduce(
        (sum, r) => sum + Number(r.amount),
        0
      ) || 0
      const prevExpenses = prevExpenseData?.reduce(
        (sum, e) => sum + Number(e.amount),
        0
      ) || 0

      periodData = {
        period,
        start_date: startDateStr,
        revenue: periodRevenue,
        expenses: periodExpenses,
        net: periodRevenue - periodExpenses,
        expenses_by_category: expensesByCategory,
        comparison: {
          prev_revenue: prevRevenue,
          prev_expenses: prevExpenses,
          prev_net: prevRevenue - prevExpenses,
          revenue_change: prevRevenue > 0
            ? ((periodRevenue - prevRevenue) / prevRevenue) * 100
            : 0,
          expense_change: prevExpenses > 0
            ? ((periodExpenses - prevExpenses) / prevExpenses) * 100
            : 0,
        },
      }
    }

    const response = {
      total: {
        revenue: Number(summary.revenue_to_date),
        expenses: Number(summary.expenses_to_date),
        net: Number(summary.revenue_to_date) - Number(summary.expenses_to_date),
        last_updated: summary.last_updated,
      },
      period: periodData,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Financials API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch financial data' },
      { status: 500 }
    )
  }
}
