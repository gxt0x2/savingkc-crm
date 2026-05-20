import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * Sidecar save endpoint for the /sell click-to-edit overlay. Receives the
 * full edit map and writes it to ~/savingkc-landing-preview/sell-edits.json
 * so I (Claude) can read it and apply changes back to SellLanding.tsx in a
 * follow-up commit.
 *
 * Preview-only — not wired to anything else. Disabled in production unless
 * SKC_ALLOW_PREVIEW_EDITS=1.
 */
export const runtime = 'nodejs'

const EditSchema = z.record(
  z.string(),
  z.object({
    text: z.string(),
    original: z.string(),
  }),
)

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' && process.env.SKC_ALLOW_PREVIEW_EDITS !== '1') {
    return NextResponse.json({ ok: false, error: 'edits disabled in production' }, { status: 403 })
  }

  let payload: z.infer<typeof EditSchema>
  try {
    payload = EditSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 })
  }

  const dir = join(process.env.HOME ?? '/tmp', 'savingkc-landing-preview')
  const file = join(dir, 'sell-edits.json')
  await mkdir(dir, { recursive: true })

  // Merge with any prior edits so partial saves don't drop earlier changes.
  let existing: z.infer<typeof EditSchema> = {}
  try {
    existing = EditSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    // No prior file or corrupted — start fresh.
  }
  const merged = { ...existing, ...payload }
  await writeFile(file, JSON.stringify(merged, null, 2), 'utf8')

  return NextResponse.json({ ok: true, applied: Object.keys(payload).length, total: Object.keys(merged).length })
}
