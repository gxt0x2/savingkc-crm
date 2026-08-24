import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const contactsPage = readFileSync('src/app/(app)/contacts/page.tsx', 'utf8')
const mobileContacts = readFileSync('src/components/contacts/mobile-contacts-list.tsx', 'utf8')

describe('Pipeline Manifest retirement', () => {
  it('shows only the governed primary action or an honest missing-action state', () => {
    expect(contactsPage).not.toContain('nextActivity')
    expect(mobileContacts).not.toContain('nextActivity')
    expect(contactsPage).toContain("row.primaryNextAction?.title || (row.hubEnriched ? 'Define next action'")
    expect(mobileContacts).toContain("row.primaryNextAction?.title || (row.hubEnriched ? 'Define next action'")
  })

  it('does not expose unreviewed Manifest tags as Pipeline filters or saved views', () => {
    expect(contactsPage).not.toContain('tagFilter')
    expect(contactsPage).not.toContain('setTagFilter')
    expect(contactsPage).not.toContain('label="Tags"')
    expect(contactsPage).toContain("source: sourceFilter, tag: ''")
  })
})
