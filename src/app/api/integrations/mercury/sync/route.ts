/**
 * ARI CRM - Mercury Transaction Sync API
 * Night 6: INT-01
 *
 * POST /api/integrations/mercury/sync - Trigger manual sync
 * GET /api/integrations/mercury/sync - Get sync status
 */

import { NextResponse } from 'next/server'
import { syncMercuryTransactions, getMercuryBalance } from '@/lib/mercury-api'

export async function POST() {
  try {
    const result = await syncMercuryTransactions()

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          credentials_configured: false,
          instructions:
            'Set MERCURY_API_KEY and MERCURY_ACCOUNT_ID environment variables to enable Mercury integration.',
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      imported: result.imported,
      message: `${result.imported} new expenses imported from Mercury`,
    })
  } catch (error) {
    console.error('Mercury sync error:', error)
    return NextResponse.json(
      { success: false, error: 'Sync failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const hasCredentials =
      !!process.env.MERCURY_API_KEY && !!process.env.MERCURY_ACCOUNT_ID

    if (!hasCredentials) {
      return NextResponse.json({
        configured: false,
        message: 'Mercury API credentials not set',
        instructions: {
          step1: 'Get API key from Mercury dashboard: https://app.mercury.com/settings/developers',
          step2: 'Add MERCURY_API_KEY to environment variables',
          step3: 'Add MERCURY_ACCOUNT_ID to environment variables',
          step4: 'Restart the application',
          step5: 'Call POST /api/integrations/mercury/sync to import transactions',
        },
      })
    }

    const balance = await getMercuryBalance()

    return NextResponse.json({
      configured: true,
      account_id: process.env.MERCURY_ACCOUNT_ID,
      current_balance: balance,
      sync_endpoint: '/api/integrations/mercury/sync',
      status: 'Ready to sync',
    })
  } catch (error) {
    console.error('Mercury status check error:', error)
    return NextResponse.json(
      { configured: false, error: 'Status check failed' },
      { status: 500 }
    )
  }
}
