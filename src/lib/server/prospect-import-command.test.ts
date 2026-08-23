import { describe, expect, it } from 'vitest'
import { MAX_PROSPECT_IMPORT_ROWS, ProspectImportError, parseProspectImportRows } from './prospect-import-command'

describe('prospect import command', () => {
  it('normalizes CSV aliases into unclassified prospect records', () => {
    expect(parseProspectImportRows({ rows: [{
      first_name: ' Jamie ',
      last_name: ' Seller ',
      phone_number: '(816) 555-0100',
      email_address: 'JAMIE@EXAMPLE.COM',
      address: '123 Main',
      postal_code: '64101',
    }] })).toEqual([expect.objectContaining({
      full_name: 'Jamie Seller',
      phone: '+18165550100',
      email: 'jamie@example.com',
      property_address: '123 Main',
      zip: '64101',
      station: 'new',
      classification: null,
      priority: 'cold',
      pipeline_intent_source: null,
    })])
  })

  it('rejects invalid or repeated phones with the CSV row number', () => {
    expect(() => parseProspectImportRows({ rows: [
      { name: 'One', phone: '8165550100' },
      { name: 'Two', phone: '+1 816 555 0100' },
    ] })).toThrow(expect.objectContaining<Partial<ProspectImportError>>({ row: 3 }))
    expect(() => parseProspectImportRows({ rows: [{ name: 'Bad', phone: '123' }] }))
      .toThrow(expect.objectContaining<Partial<ProspectImportError>>({ row: 2 }))
  })

  it('refuses oversized batches instead of partially importing them', () => {
    expect(() => parseProspectImportRows({
      rows: Array.from({ length: MAX_PROSPECT_IMPORT_ROWS + 1 }, () => ({ phone: '8165550100' })),
    })).toThrow(`Import at most ${MAX_PROSPECT_IMPORT_ROWS}`)
  })
})
