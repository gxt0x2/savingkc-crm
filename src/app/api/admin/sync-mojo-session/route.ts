/**
 * POST /api/admin/sync-mojo-session
 * Reads the Mojo session file from disk (production Mac) and stores it in Supabase.
 * This endpoint only works on the production Mac where the session file exists.
 */
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'



const SESSION_FILE_PATHS = [
  join(homedir(), '.openclaw/workspace/memory/mojo-session.json'),
  '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json',
]

export async function POST(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const results: string[] = []

  // Try to read session from disk
  let sessionId: string | null = null
  for (const filePath of SESSION_FILE_PATHS) {
    try {
      const content = await readFile(filePath, 'utf8')
      const session = JSON.parse(content)
      if (!session.expired && session.sessionId) {
        sessionId = session.sessionId
        results.push(`Found session in ${filePath}`)
        break
      } else {
        results.push(`Session at ${filePath} is expired or missing sessionId`)
      }
    } catch (e: any) {
      results.push(`Cannot read ${filePath}: ${e.code || e.message}`)
    }
  }

  if (!sessionId) {
    return NextResponse.json({
      success: false,
      message: 'No valid Mojo session file found on this machine',
      details: results,
      homedir: homedir(),
    })
  }

  // Upsert the session (system_config table must exist)
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'mojo_session_id',
      value: sessionId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({
      success: false,
      message: `Failed to store in Supabase: ${error.message}`,
      details: results,
    })
  }

  results.push('Session stored in Supabase system_config')
  return NextResponse.json({
    success: true,
    sessionPrefix: sessionId.substring(0, 10) + '...',
    details: results,
  })
}
