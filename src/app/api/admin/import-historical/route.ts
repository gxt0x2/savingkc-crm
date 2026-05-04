/**
 * ARI CRM - Historical Data Import API
 * Night 6: DSH-05, INT-03
 *
 * POST /api/admin/import-historical - Import historical data from Google Sheets or CSV
 *
 * Accepts JSON payload with one of:
 * - closings: Array of { date, amount, property_address, description }
 * - contracts: Array of { date, property_address, amount, status }
 * - call_metrics: Array of { date, calls_made, conversations, talk_time }
 * - expenses: Array of { date, amount, category, description, merchant }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

interface ClosingRecord {
  date: string
  amount: number
  property_address: string
  description?: string
  deal_id?: string
}

interface ContractRecord {
  date: string
  property_address: string
  amount: number
  status: string
}

interface CallMetric {
  date: string
  calls_made: number
  conversations: number
  talk_time?: number
}

interface ExpenseRecord {
  date: string
  amount: number
  category: 'operations' | 'marketing' | 'travel' | 'general' | 'payroll' | 'software'
  description: string
  merchant?: string
}

interface ImportPayload {
  data_type: 'closings' | 'contracts' | 'call_metrics' | 'expenses'
  source?: string
  records:
    | ClosingRecord[]
    | ContractRecord[]
    | CallMetric[]
    | ExpenseRecord[]
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const payload: ImportPayload = await request.json()
    const { data_type, source = 'manual_import', records } = payload

    if (!data_type || !records || !Array.isArray(records)) {
      return NextResponse.json(
        { error: 'Invalid payload. Requires data_type and records array.' },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    let importedCount = 0

    switch (data_type) {
      case 'closings': {
        const closings = records as ClosingRecord[]
        for (const closing of closings) {
          const { error } = await supabase.from('revenue_transactions').insert({
            date: closing.date,
            amount: closing.amount,
            property_address: closing.property_address,
            description: closing.description || 'Historical closing',
            source: 'import',
            metadata: { imported_from: source },
          })
          if (!error) importedCount++
        }

        // Update financial summary
        const totalRevenue = closings.reduce((sum, c) => sum + c.amount, 0)
        await supabase.rpc('increment_revenue', { amount: totalRevenue })

        break
      }

      case 'contracts': {
        const contracts = records as ContractRecord[]
        // Contracts would be stored in leads table or a separate contracts table
        // For now, log them as lead_activities
        for (const contract of contracts) {
          // Find lead by property address or create
          const { data: existingLead } = await supabase
            .from('leads')
            .select('id')
            .eq('property_address', contract.property_address)
            .single()

          let leadId = existingLead?.id

          if (!leadId) {
            // Create stub lead for historical contract
            const { data: newLead } = await supabase
              .from('leads')
              .insert({
                property_address: contract.property_address,
                station: 'under_contract',
                source: 'historical_import',
                full_name: 'Historical Contract',
              })
              .select('id')
              .single()

            leadId = newLead?.id
          }

          if (leadId) {
            await supabase.from('lead_activities').insert({
              lead_id: leadId,
              type: 'contract_event',
              description: `Historical contract: ${contract.status}`,
              metadata: {
                contract_date: contract.date,
                contract_amount: contract.amount,
                status: contract.status,
                imported_from: source,
              },
            })
            importedCount++
          }
        }
        break
      }

      case 'call_metrics': {
        const metrics = records as CallMetric[]
        for (const metric of metrics) {
          const { error } = await supabase.from('agent_daily_stats').insert({
            agent_id: 'casey', // Default agent
            date: metric.date,
            calls_made: metric.calls_made,
            meaningful_conversations: metric.conversations,
            metadata: {
              talk_time: metric.talk_time,
              imported_from: source,
            },
          })
          if (!error) importedCount++
        }
        break
      }

      case 'expenses': {
        const expenses = records as ExpenseRecord[]
        for (const expense of expenses) {
          const { error } = await supabase.from('expense_transactions').insert({
            date: expense.date,
            amount: expense.amount,
            category: expense.category,
            description: expense.description,
            merchant: expense.merchant,
            source: 'import',
            metadata: { imported_from: source },
          })
          if (!error) importedCount++
        }

        // Update financial summary
        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
        await supabase.rpc('increment_expenses', { amount: totalExpenses })

        break
      }

      default:
        return NextResponse.json(
          { error: `Unknown data_type: ${data_type}` },
          { status: 400 }
        )
    }

    // Log the import
    await supabase.from('historical_data_imports').insert({
      data_type,
      source,
      record_count: importedCount,
      imported_by: 'admin',
      metadata: { total_records: records.length },
    })

    return NextResponse.json({
      success: true,
      data_type,
      imported: importedCount,
      total: records.length,
    })
  } catch (error) {
    console.error('Historical data import error:', error)
    return NextResponse.json(
      { error: 'Failed to import historical data' },
      { status: 500 }
    )
  }
}

/**
 * GET - Returns import instructions and sample payload
 */
export async function GET(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  const instructions = {
    endpoint: '/api/admin/import-historical',
    method: 'POST',
    description:
      'Import historical data from Google Sheets, CSV, or other sources',
    payload_format: {
      data_type: 'closings | contracts | call_metrics | expenses',
      source: 'google_sheets | csv | manual (optional)',
      records: 'Array of records based on data_type',
    },
    examples: {
      closings: {
        data_type: 'closings',
        source: 'google_sheets',
        records: [
          {
            date: '2026-01-15',
            amount: 15000,
            property_address: '123 Main St, Kansas City, MO 64111',
            description: 'Wholesale deal - January',
          },
        ],
      },
      expenses: {
        data_type: 'expenses',
        source: 'google_sheets',
        records: [
          {
            date: '2026-02-01',
            amount: 450.5,
            category: 'operations',
            description: 'Office supplies and software',
            merchant: 'Office Depot',
          },
        ],
      },
      call_metrics: {
        data_type: 'call_metrics',
        source: 'google_sheets',
        records: [
          {
            date: '2026-03-15',
            calls_made: 120,
            conversations: 8,
            talk_time: 240,
          },
        ],
      },
    },
    google_sheets_url:
      'https://docs.google.com/spreadsheets/d/15QlmO_4zYMGWgS-C62hS1LAcoK5oNzmBAgLAiyQ8S4I/',
    notes: [
      'If Google Sheets API is not configured, export sheets as CSV and convert to JSON',
      'Revenue baseline starts at $0 (DSH-06)',
      'Expenses seeded at $1,775 from migrations (DSH-07)',
      'Call this endpoint to import historical closings/contracts/metrics',
    ],
  }

  return NextResponse.json(instructions, { status: 200 })
}
