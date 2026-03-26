/**
 * ARI CRM - Mercury API Integration
 * Night 6: INT-01
 *
 * Banking transaction sync and expense categorization
 * Requires: MERCURY_API_KEY, MERCURY_ACCOUNT_ID env vars
 */

import { createClient } from '@supabase/supabase-js'

export interface MercuryTransaction {
  id: string
  amount: number
  postedAt: string
  status: string
  counterpartyName: string
  counterpartyNickname?: string
  note?: string
  dashboardLink: string
}

export interface CategorizedExpense {
  transaction_id: string
  date: string
  amount: number
  category: 'operations' | 'marketing' | 'travel' | 'general' | 'payroll' | 'software'
  merchant: string
  description: string
}

/**
 * Categorize expense based on merchant name and transaction details
 */
export function categorizeExpense(transaction: MercuryTransaction): CategorizedExpense['category'] {
  const merchant = (transaction.counterpartyName || '').toLowerCase()
  const note = (transaction.note || '').toLowerCase()

  // Travel
  if (
    merchant.includes('uber') ||
    merchant.includes('lyft') ||
    merchant.includes('gas') ||
    merchant.includes('fuel') ||
    merchant.includes('parking') ||
    merchant.includes('airline') ||
    merchant.includes('hotel') ||
    note.includes('travel') ||
    note.includes('mileage')
  ) {
    return 'travel'
  }

  // Marketing
  if (
    merchant.includes('facebook') ||
    merchant.includes('meta') ||
    merchant.includes('google ads') ||
    merchant.includes('mailchimp') ||
    merchant.includes('hubspot') ||
    merchant.includes('marketing') ||
    note.includes('marketing') ||
    note.includes('advertising')
  ) {
    return 'marketing'
  }

  // Software
  if (
    merchant.includes('software') ||
    merchant.includes('saas') ||
    merchant.includes('github') ||
    merchant.includes('vercel') ||
    merchant.includes('supabase') ||
    merchant.includes('twilio') ||
    merchant.includes('zapier') ||
    merchant.includes('subscription') ||
    note.includes('software')
  ) {
    return 'software'
  }

  // Payroll
  if (
    merchant.includes('payroll') ||
    merchant.includes('gusto') ||
    merchant.includes('adp') ||
    note.includes('payroll') ||
    note.includes('salary')
  ) {
    return 'payroll'
  }

  // Operations (office, meals, supplies)
  if (
    merchant.includes('office') ||
    merchant.includes('staples') ||
    merchant.includes('restaurant') ||
    merchant.includes('coffee') ||
    merchant.includes('lunch') ||
    merchant.includes('dinner') ||
    merchant.includes('meal') ||
    note.includes('office') ||
    note.includes('meal')
  ) {
    return 'operations'
  }

  // Default to general
  return 'general'
}

/**
 * Fetch recent transactions from Mercury API
 */
export async function fetchMercuryTransactions(
  limit: number = 100
): Promise<MercuryTransaction[] | null> {
  const apiKey = process.env.MERCURY_API_KEY
  const accountId = process.env.MERCURY_ACCOUNT_ID

  if (!apiKey || !accountId) {
    console.warn(
      'Mercury API credentials not configured. Set MERCURY_API_KEY and MERCURY_ACCOUNT_ID env vars.'
    )
    return null
  }

  try {
    const response = await fetch(
      `https://api.mercury.com/api/v1/accounts/${accountId}/transactions?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      console.error('Mercury API request failed:', response.statusText)
      return null
    }

    const data = await response.json()
    return data.transactions || []
  } catch (error) {
    console.error('Mercury API error:', error)
    return null
  }
}

/**
 * Sync Mercury transactions to expense_transactions table
 * Returns count of new expenses imported
 */
export async function syncMercuryTransactions(): Promise<{
  success: boolean
  imported: number
  error?: string
}> {
  const transactions = await fetchMercuryTransactions(100)

  if (!transactions) {
    return {
      success: false,
      imported: 0,
      error: 'Mercury API credentials not configured or API request failed',
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Filter to only debits (expenses)
  const expenses = transactions.filter((t) => t.amount < 0)

  let importedCount = 0

  for (const transaction of expenses) {
    // Check if already imported
    const { data: existing } = await supabase
      .from('expense_transactions')
      .select('id')
      .eq('external_id', transaction.id)
      .single()

    if (existing) {
      continue // Skip duplicates
    }

    // Categorize and import
    const category = categorizeExpense(transaction)
    const amount = Math.abs(transaction.amount) // Convert negative to positive

    const { error } = await supabase.from('expense_transactions').insert({
      date: transaction.postedAt.split('T')[0],
      amount,
      category,
      description: transaction.note || `Mercury transaction from ${transaction.counterpartyName}`,
      merchant: transaction.counterpartyName,
      source: 'mercury',
      external_id: transaction.id,
      metadata: {
        mercury_link: transaction.dashboardLink,
        counterparty_nickname: transaction.counterpartyNickname,
        status: transaction.status,
      },
    })

    if (!error) {
      importedCount++

      // Update financial summary
      await supabase.rpc('increment_expenses', { amount })
    }
  }

  return {
    success: true,
    imported: importedCount,
  }
}

/**
 * Get Mercury account balance (if API configured)
 */
export async function getMercuryBalance(): Promise<number | null> {
  const apiKey = process.env.MERCURY_API_KEY
  const accountId = process.env.MERCURY_ACCOUNT_ID

  if (!apiKey || !accountId) {
    return null
  }

  try {
    const response = await fetch(
      `https://api.mercury.com/api/v1/accounts/${accountId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.currentBalance || 0
  } catch (error) {
    console.error('Mercury balance fetch error:', error)
    return null
  }
}
