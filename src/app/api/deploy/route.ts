import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import path from 'path'

const DEPLOY_LOG = path.join(process.env.HOME || '/root', 'savingkc-crm/deploy.log')

// GET — check deploy status (reads last 5 lines of deploy.log)
export async function GET() {
  try {
    const log = readFileSync(DEPLOY_LOG, 'utf-8')
    const lines = log.trim().split('\n')
    const last5 = lines.slice(-5)
    const lastComplete = lines.filter(l => l.includes('Deploy complete')).pop()
    const lastStarted = lines.filter(l => l.includes('Deploy started')).pop()

    return NextResponse.json({
      lastDeploy: lastComplete || null,
      lastStarted: lastStarted || null,
      recentLog: last5,
    })
  } catch {
    return NextResponse.json({ lastDeploy: null, message: 'No deploy log found' })
  }
}

// POST — GitHub webhook (acknowledged only, deploy runs via cron)
export async function POST() {
  return NextResponse.json({ message: 'Webhook received. Deploy runs via cron polling.' }, { status: 200 })
}
