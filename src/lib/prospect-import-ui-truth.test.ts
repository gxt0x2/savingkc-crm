import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const contactsPage = readFileSync(join(process.cwd(), 'src/app/(app)/contacts/page.tsx'), 'utf8')

describe('campaign prospect import UI contract', () => {
  it('passes campaign context to the atomic import route and returns to the campaign', () => {
    expect(contactsPage).toContain('JSON.stringify({ rows: csvRows, campaignId: requestedCampaignId })')
    expect(contactsPage).toContain('router.push(campaignAudienceReturnHref(requestedCampaignId))')
  })

  it('states the no-outreach boundary before import', () => {
    expect(contactsPage).toContain('No calls or messages will start.')
    expect(contactsPage).toContain("requestedCampaignId ? 'Import to campaign' : 'Import contacts'")
  })
})
