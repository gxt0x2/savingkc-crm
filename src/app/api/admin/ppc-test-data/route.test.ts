import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DELETE, GET } from './route'

describe('production PPC test-data cleanup retirement', () => {
  it.each([
    ['GET', GET],
    ['DELETE', DELETE],
  ])('returns a permanent replacement for %s', async (_method, handler) => {
    const response = await handler()
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      code: 'ppc_test_data_cleanup_retired',
    })
  })

  it('cannot query or delete production CRM data', () => {
    const source = readFileSync('src/app/api/admin/ppc-test-data/route.ts', 'utf8')
    expect(source).not.toContain('supabase')
    expect(source).not.toContain("from('")
    expect(source).not.toContain('.delete(')
    expect(source).not.toContain('manifests')
  })
})
