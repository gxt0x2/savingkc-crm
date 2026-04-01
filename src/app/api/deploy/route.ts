import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import crypto from 'crypto'
import path from 'path'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET
const DEPLOY_SCRIPT = path.join(process.env.HOME || '/root', 'savingkc-crm/scripts/deploy.sh')

// In-memory deploy status (persists across requests while the process is running)
let lastDeploy: {
  status: 'idle' | 'deploying' | 'success' | 'failed'
  timestamp: string | null
  commit: string | null
  error: string | null
} = {
  status: 'idle',
  timestamp: null,
  commit: null,
  error: null,
}

function verifySignature(payload: string, signature: string | null): boolean {
  if (!DEPLOY_SECRET || !signature) return false
  const hmac = crypto.createHmac('sha256', DEPLOY_SECRET)
  hmac.update(payload, 'utf8')
  const digest = `sha256=${hmac.digest('hex')}`
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}

// GET — check deploy status
export async function GET() {
  return NextResponse.json(lastDeploy)
}

// POST — GitHub webhook handler
export async function POST(request: Request) {
  if (!DEPLOY_SECRET) {
    return NextResponse.json({ error: 'DEPLOY_SECRET not configured' }, { status: 500 })
  }

  const body = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only deploy on pushes to main
  const ref = payload.ref as string | undefined
  if (ref !== 'refs/heads/main') {
    return NextResponse.json({ message: `Ignored push to ${ref}` }, { status: 200 })
  }

  // Extract commit info
  const headCommit = payload.head_commit as Record<string, unknown> | undefined
  const commitMessage = (headCommit?.message as string) || 'unknown'
  const commitId = ((headCommit?.id as string) || 'unknown').substring(0, 7)

  // Don't queue if already deploying
  if (lastDeploy.status === 'deploying') {
    return NextResponse.json({ message: 'Deploy already in progress' }, { status: 202 })
  }

  // Start deploy in background (detached so CRM restart doesn't kill it)
  lastDeploy = {
    status: 'deploying',
    timestamp: new Date().toISOString(),
    commit: `${commitId} - ${commitMessage}`,
    error: null,
  }

  // Use nohup + disown pattern so the deploy survives the CRM restart
  exec(
    `nohup bash "${DEPLOY_SCRIPT}" > /tmp/savingkc-deploy-output.log 2>&1 &`,
    { timeout: 5000 },
    (error) => {
      if (error) {
        lastDeploy.status = 'failed'
        lastDeploy.error = error.message
      } else {
        // The script was kicked off successfully
        // We mark success optimistically — check deploy.log for actual status
        lastDeploy.status = 'success'
        lastDeploy.timestamp = new Date().toISOString()
      }
    }
  )

  return NextResponse.json({
    message: 'Deploy started',
    commit: `${commitId} - ${commitMessage}`,
  }, { status: 200 })
}
