import { describe, expect, it } from 'vitest'
import { cleanLeadSearch, crmLeadUrl } from './read-model'

describe('assistant read model', () => {
  it('removes PostgREST wildcard and grouping syntax from searches', () => {
    expect(cleanLeadSearch('  Smith%,_* (test)  ')).toBe('Smith test')
  })

  it('limits search length', () => {
    expect(cleanLeadSearch('x'.repeat(200))).toHaveLength(120)
  })

  it('builds a canonical CRM record URL', () => {
    expect(crmLeadUrl('lead 123')).toBe('https://crm.savingkc.com/leads/lead%20123')
  })
})
