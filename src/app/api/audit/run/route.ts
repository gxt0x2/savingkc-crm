import { NextResponse } from 'next/server'
import { runDataQualityAudit, verifySystemHealth } from '@/lib/ari-audit-engine'

/**
 * POST /api/audit/run
 * Runs the full Ari audit engine (AUD-01 + AUD-04)
 * Can be called manually or via cron
 */
export async function POST() {
  try {
    // Run data quality audit
    const findings = await runDataQualityAudit()

    // Run system health verification
    await verifySystemHealth()

    return NextResponse.json({
      success: true,
      findings_count: findings.length,
      findings: findings.slice(0, 10), // Return first 10 for preview
      message: `Audit complete. Found ${findings.length} issues.`,
    })
  } catch (error: unknown) {
    console.error('Audit run error:', error)
    const message = error instanceof Error ? error.message : 'Audit run failed'
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/audit/run
 * Same as POST, for easy cron triggering via GET request
 */
export async function GET() {
  return POST()
}
