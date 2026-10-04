import { describe, expect, it, vi } from 'vitest'
import { FORECLOSURE_EQUITY_FLOOR } from '@/lib/prospecting/foreclosure'
import { COURT_COUNTIES, COURT_FILING_COVERAGE, COURT_LEAD_TYPES, coverageCell, gapsForLane } from '@/lib/prospecting/court-filing-coverage'
import {
  classifyPublicFilingResponse,
  foreclosureCsvAccepted,
  presentFilingLane,
  probePublicFilingSource,
  routeCourtRecord,
} from '@/lib/prospecting/court-filing-source'

const CASENET_BLOCK = '<p>Access by a site data scraper is expressly prohibited.</p>'
const KANSAS_BLOCK = '<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>'
const JACKSON_LOGIN = '<title>Browser Test - Jackson County Public Access Search</title><input id="LoginForm1_txtPassword" title="Password field" />'

const sample = {
  county: 'jackson',
  state: 'MO',
  partyName: 'Ada Owner',
  situs: '1 Main St, Kansas City, MO 64101',
  caseNumber: '2416-CV00001',
  filedOn: '2026-10-01',
  sourceName: 'Case.net',
  sourceUrl: 'https://www.courts.mo.gov/casenet/',
}

describe('public filing probes', () => {
  it('records Case.net, Kansas Case Search, and the Jackson recorder as blocked and stores no rows', () => {
    expect(classifyPublicFilingResponse('casenet', 403, CASENET_BLOCK).rows).toEqual([])
    expect(classifyPublicFilingResponse('casenet', 403, CASENET_BLOCK).reason).toMatch(/expressly prohibited/i)
    expect(classifyPublicFilingResponse('kansasCaseSearch', 403, KANSAS_BLOCK).rows).toEqual([])
    expect(classifyPublicFilingResponse('kansasCaseSearch', 403, KANSAS_BLOCK).reason).toMatch(/blocked/i)
    expect(classifyPublicFilingResponse('jacksonRecorder', 200, JACKSON_LOGIN).rows).toEqual([])
    expect(classifyPublicFilingResponse('jacksonRecorder', 200, JACKSON_LOGIN).reason).toMatch(/Browser Test/)
    expect(classifyPublicFilingResponse('jacksonRecorder', 200, '<title>Search Real Estate Index: Selection Criteria - Jackson County Public Access Search</title><input id="LoginForm1_txtPassword" />').reason).not.toMatch(/Browser Test/)
    expect(classifyPublicFilingResponse('casenet', 200, '<html><title>Search</title></html>').rows).toEqual([])
  })

  it('does not call the network twice and does not invent rows when fetch fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    })
    const result = await probePublicFilingSource('casenet', fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.rows).toEqual([])
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/closed/i)
  })
})

describe('filing lanes stay out of the foreclosure dial queue', () => {
  it('keeps the mortgage equity floor at $75,000', () => {
    expect(FORECLOSURE_EQUITY_FLOOR).toBe(75_000)
  })

  it('sends a divorce to the court filing table and never to a foreclosure csv', () => {
    const routed = routeCourtRecord({ ...sample, kind: 'divorce', situs: '9 Side St' })
    expect(routed.destination).toBe('court_filing')
    expect(routed.dialerEnrolled).toBe(false)
    if (routed.destination === 'court_filing') expect(routed.row.filingKind).toBe('divorce')
  })

  it('keeps probate on the existing inheritance list', () => {
    const routed = routeCourtRecord({ ...sample, kind: 'probate' })
    expect(routed).toEqual({ destination: 'existing_inheritance_list', write: false, dialerEnrolled: false })
  })

  it('imports a judicial foreclosure only when owner and situs both exist', () => {
    const ready = routeCourtRecord({ ...sample, kind: 'judicial_foreclosure' })
    expect(ready.destination).toBe('foreclosure_csv')
    if (ready.destination !== 'foreclosure_csv') return
    const parsed = foreclosureCsvAccepted(ready.csv)
    expect(parsed.accepted).toHaveLength(1)
    expect(parsed.accepted[0].county).toBe('jackson')
    expect(parsed.accepted[0].noticeType).toBe('lis_pendens')
    expect(parsed.accepted[0].phones).toEqual([])
    expect(parsed.accepted[0].estEquity).toBeNull()
    const siteless = routeCourtRecord({ ...sample, kind: 'lis_pendens', situs: null })
    expect(siteless.destination).toBe('court_filing')
    expect(siteless.dialerEnrolled).toBe(false)
  })

  it('keeps liens off the foreclosure model', () => {
    const lien = routeCourtRecord({ ...sample, kind: 'hoa_lien', sourceName: 'Jackson recorder' })
    expect(lien.destination).toBe('recorder_lien')
    expect(lien.dialerEnrolled).toBe(false)
    const tax = routeCourtRecord({ ...sample, county: 'johnson', state: 'KS', kind: 'federal_tax_lien' })
    expect(tax.destination).toBe('recorder_lien')
  })

  it('drops dialer-flagged and out-of-county rows from the visible lane', () => {
    const view = presentFilingLane('divorce', [
      { id: '1', county: 'jackson', state: 'MO', filing_kind: 'divorce', party_name: 'Ada Owner', dialer_enrolled: false },
      { id: '2', county: 'jackson', state: 'MO', filing_kind: 'divorce', party_name: 'Should Drop', dialer_enrolled: true },
      { id: '3', county: 'clay', state: 'MO', filing_kind: 'divorce', party_name: 'Clay Owner', dialer_enrolled: false },
    ])
    expect(view.dialerEnrolled).toBe(false)
    expect(view.rows.map((row) => row.partyName)).toEqual(['Ada Owner'])
    expect(view.rows[0].dialerEnrolled).toBe(false)
    expect(view.gaps.map((gap) => gap.county)).toEqual(['jackson', 'johnson'])
    expect(view.outOfScope).toMatch(/Clay, Wyandotte, Platte, and Cass/)
  })

  it('covers every county and lead type once', () => {
    expect(COURT_FILING_COVERAGE).toHaveLength(COURT_COUNTIES.length * COURT_LEAD_TYPES.length)
    const keys = new Set(COURT_FILING_COVERAGE.map((cell) => `${cell.county}:${cell.leadType}`))
    expect(keys.size).toBe(COURT_FILING_COVERAGE.length)
    for (const county of ['clay', 'wyandotte', 'platte', 'cass'] as const) {
      expect(COURT_FILING_COVERAGE.filter((cell) => cell.county === county).every((cell) => cell.status === 'cannot')).toBe(true)
    }
    expect(coverageCell('jackson', 'federal_tax_lien').status).toBe('built')
    expect(coverageCell('jackson', 'hoa_lien').status).toBe('built')
    expect(coverageCell('jackson', 'divorce').status).toBe('cannot')
    expect(coverageCell('jackson', 'lis_pendens').reason).toMatch(/expressly prohibited/i)
    expect(gapsForLane('lien').map((cell) => cell.county)).toEqual(['johnson', 'johnson'])
  })
})
