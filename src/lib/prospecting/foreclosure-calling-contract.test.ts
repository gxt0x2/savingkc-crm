import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(process.cwd(), 'src/app/(app)/prospecting/page.tsx'), 'utf8')
const floor = readFileSync(join(process.cwd(), 'src/components/prospecting/prospecting-calling-floor.tsx'), 'utf8')
const shell = readFileSync(join(process.cwd(), 'src/components/layout/app-shell.tsx'), 'utf8')
const sections = readFileSync(join(process.cwd(), 'src/components/conversations/workspace-submenu.tsx'), 'utf8')

describe('foreclosure calling reuse', () => {
  it('opens the existing Prospecting calling floor for a prepared source prospect', () => {
    expect(page).toContain('params.prospect_ids?.trim()')
    expect(page).toContain('return <ProspectingCallingFloor')
    expect(floor).toContain("params.get('prospect_ids')")
    expect(floor).toContain("kind: 'prospect'")
    expect(shell).toContain("searchParams.get('prospect_ids')")
    expect(sections).toContain("label: 'Foreclosure', href: '/prospecting/foreclosure'")
  })
})
