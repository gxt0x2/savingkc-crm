import { describe, expect, it } from 'vitest'
import { parseForeclosureCsv } from '@/lib/prospecting/foreclosure'
import {
  MOPUBLICNOTICES_COMPUTER_USE_GAP,
  buildCountyPublicCsv,
  noticeRegistryForeclosureUrls,
  parseJocoSales,
  parseLegalRecordMf,
  parseNoticeRegistryHtml,
  parseSouthlawReport,
  pdfItemsToLines,
} from '@/lib/server/foreclosure-county-public'

const SOUTHLAW_MO = `
Foreclosure Sales Report: Missouri
Jackson
2903 Bales Ave | Kansas City | 64128 | 10/1/2026 | 1:00PM | N/A | N/A | Independence | 260761
Jasper
201 S 1st St | Jasper | 64755 | 10/21/2026 | 9:30AM | N/A | N/A | Carthage | 260545
`

const SOUTHLAW_KS = `
Johnson
401 N Locust St | Gardner | 66030 | 9/30/2026 | 10:00AM | N/A | N/A | Olathe | JO-2026-CV-000523 | 257588
Wyandotte
1 Main St | Kansas City | 66101 | 10/1/2026 | 10:00AM | N/A | $10.00 | Kansas City | WY-2026-CV-000001 | 111111
`

const NR_HTML = `
<title>Sep 11, 2026 Foreclosure: 2903 Bales Ave, Kansas City, MO 64128 | Missouri | NoticeRegistry</title>
<script>self.__next_f.push([1,"{\\"address\\":\\"2903 Bales Ave, Kansas City, MO 64128\\"} executed by Topstone INV MCI 1, LLC, dated May 9, 2025, Document No. 2025E0032959 in the Office of the Recorder of Deeds, Jackson County, Missouri"])</script>
`

describe('county public parsers', () => {
  it('keeps Jackson SouthLaw rows and drops other counties', () => {
    const rows = parseSouthlawReport(SOUTHLAW_MO, 'Jackson')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ address: '2903 Bales Ave', city: 'Kansas City', zip: '64128', firmFile: '260761' })
  })

  it('joins JoCo defendant to SouthLaw Johnson situs and skips siteless sales', () => {
    const sales = parseJocoSales({
      SalesList: [
        {
          Status: 'PENDING',
          SaleDateString: '09/30/2026',
          SaleTimeString: '10:00 AM',
          SaleHeaderText: 'This property has not been sold.',
          CaseNumber: 'JO-2026-CV-000523',
          PlaintiffName: 'LAKEVIEW LOAN SERVICING, LLC, ET AL',
          DefendantName: 'BENJAMIN PATRICK HALL, ET AL',
          AttorneyName: 'SOUTHLAW P.C.',
          FirstPublicationDate: '09/8/2026',
        },
        {
          Status: 'PENDING',
          SaleDateString: '10/07/2026',
          CaseNumber: 'JO-2026-CV-000999',
          DefendantName: 'NO ADDRESS OWNER',
          PlaintiffName: 'BANK',
        },
      ],
    })
    const built = buildCountyPublicCsv({
      pullDate: '2026-10-02',
      southlawJackson: [],
      southlawJohnson: parseSouthlawReport(SOUTHLAW_KS, 'Johnson'),
      jocoSales: sales,
      legalRecord: [],
      notices: [],
    })
    expect(built.stats.importable).toBe(1)
    expect(built.stats.skippedNoSitus).toBe(1)
    const parsed = parseForeclosureCsv(built.csv)
    expect(parsed.accepted).toHaveLength(1)
    expect(parsed.accepted[0].county).toBe('johnson')
    expect(parsed.accepted[0].situs).toContain('401 N Locust St')
    expect(parsed.accepted[0].ownerName).toContain('BENJAMIN')
    expect(parsed.accepted[0].noticeType).toBe('sheriff_sale')
    expect(parsed.rejected).toHaveLength(0)
  })

  it('parses Legal Record MF and excludes TF', () => {
    const text = [
      'THE LEGAL RECORD SEPTEMBER 22, 2026',
      'SOME COUNTY VS. TAX OWNER ................................ TF ........... JO-2026-CV-000010',
      'ROCKET MORTGAGE, LLC VS. ........................................ SABRINA WALKER, ET AL. .......................................................... MF ........... JO-2026-CV-002367',
    ].join('\n')
    const parsed = parseLegalRecordMf(text)
    expect(parsed.taxCases).toBe(1)
    expect(parsed.filings.map((row) => row.caseNumber)).toEqual(['JO-2026-CV-002367'])
    expect(parsed.filings[0].defendant).toContain('SABRINA WALKER')
    expect(parsed.issueDate).toBe('2026-09-22')
  })

  it('reads a Jackson NoticeRegistry page and documents the mopublicnotices gap', () => {
    const hit = parseNoticeRegistryHtml(NR_HTML, 'https://www.noticeregistry.com/missouri/notice/foreclosure-kansas-city-1269670')
    expect(hit?.owner).toContain('Topstone')
    expect(hit?.zip).toBe('64128')
    const built = buildCountyPublicCsv({
      pullDate: '2026-10-02',
      southlawJackson: parseSouthlawReport(SOUTHLAW_MO, 'Jackson'),
      southlawJohnson: [],
      jocoSales: [],
      legalRecord: [],
      notices: hit ? [hit] : [],
    })
    expect(built.notes[0]).toBe(MOPUBLICNOTICES_COMPUTER_USE_GAP)
    const parsed = parseForeclosureCsv(built.csv)
    expect(parsed.accepted).toHaveLength(1)
    expect(parsed.accepted[0].noticeType).toBe('notice_of_sale')
    expect(parsed.accepted[0].saleDate).toBe('2026-10-01')
    expect(parsed.accepted[0].trusteeOrFirm).toContain('260761')
    expect(built.stats.skippedNoOwner).toBe(0)
  })

  it('ranks recent metro foreclosure sitemap urls', () => {
    const xml = `
      <url><loc>https://www.noticeregistry.com/missouri/notice/foreclosure-st-louis-1</loc><lastmod>2026-09-20</lastmod></url>
      <url><loc>https://www.noticeregistry.com/missouri/notice/foreclosure-kansas-city-2</loc><lastmod>2026-09-01</lastmod></url>
      <url><loc>https://www.noticeregistry.com/missouri/notice/bid-notice-kansas-city-3</loc><lastmod>2026-09-20</lastmod></url>
      <url><loc>https://www.noticeregistry.com/missouri/notice/foreclosure-kansas-city-9</loc><lastmod>2026-01-01</lastmod></url>
    `
    const urls = noticeRegistryForeclosureUrls(xml, new Date('2026-10-02T15:00:00-05:00'), 75)
    expect(urls[0]).toContain('kansas-city-2')
    expect(urls.some((url) => url.includes('st-louis'))).toBe(true)
    expect(urls.some((url) => url.includes('bid-notice'))).toBe(false)
    expect(urls.some((url) => url.endsWith('-9'))).toBe(false)
  })

  it('groups pdf text items into columns', () => {
    const lines = pdfItemsToLines([
      { str: 'Jackson', transform: [1, 0, 0, 1, 40, 700] },
      { str: '2903 Bales Ave', transform: [1, 0, 0, 1, 40, 680] },
      { str: 'Kansas City', transform: [1, 0, 0, 1, 180, 680] },
      { str: '64128', transform: [1, 0, 0, 1, 280, 680] },
    ])
    expect(lines[0]).toBe('Jackson')
    expect(lines[1]).toContain('2903 Bales Ave')
    expect(lines[1]).toContain('|')
    expect(lines[1]).toContain('64128')
  })
})
