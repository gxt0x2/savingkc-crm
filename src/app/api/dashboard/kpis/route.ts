import { NextResponse } from 'next/server'
import { CASEY_MONTHLY_KPIS, getYtdTotals } from '@/lib/kpi-data'

export async function GET() {
  return NextResponse.json({
    agent: 'Casey Davis',
    monthly: CASEY_MONTHLY_KPIS,
    ytd: getYtdTotals(),
  })
}
