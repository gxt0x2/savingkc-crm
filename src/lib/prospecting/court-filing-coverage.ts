export const COURT_LEAD_TYPES = [
  'divorce',
  'probate',
  'foreclosure_notice',
  'lis_pendens',
  'federal_tax_lien',
  'hoa_lien',
  'sheriff_sale',
] as const

export const COURT_COUNTIES = ['jackson', 'johnson', 'clay', 'wyandotte', 'platte', 'cass'] as const

export type CourtLeadType = (typeof COURT_LEAD_TYPES)[number]
export type CourtCounty = (typeof COURT_COUNTIES)[number]
export type CoverageStatus = 'built' | 'already_existed' | 'cannot'

export type CoverageCell = {
  county: CourtCounty
  leadType: CourtLeadType
  status: CoverageStatus
  reason: string
}

const OUT_OF_PASS = 'Owner limited this pass to Jackson County MO and Johnson County KS, so no fetcher was added.'
const CASS = 'No public Cass County source was already obvious in this repo, and paid vendors were not hunted.'

const SCOPED: CoverageCell[] = [
  { county: 'jackson', leadType: 'divorce', status: 'cannot', reason: 'Case.net returned HTTP 403 and says automated scraping of Missouri judicial sites is expressly prohibited, so no divorce rows are stored.' },
  { county: 'jackson', leadType: 'probate', status: 'already_existed', reason: 'Probate stays on the existing deceased inheritance audience (prospects.is_deceased); Case.net is not a second probate pipeline.' },
  { county: 'jackson', leadType: 'foreclosure_notice', status: 'already_existed', reason: 'Weekday county_public already pulls Jackson trustee notices from NoticeRegistry and SouthLaw, and Case.net does not replace that pull.' },
  { county: 'jackson', leadType: 'lis_pendens', status: 'cannot', reason: 'A Jackson lis pendens court case would come from Case.net, which blocks automated access, and no other stable public feed was added.' },
  { county: 'jackson', leadType: 'federal_tax_lien', status: 'cannot', reason: 'The Jackson recorder public search responds with an ASP.NET browser-test login form, so there is no stable unauthenticated lien fetch.' },
  { county: 'jackson', leadType: 'hoa_lien', status: 'cannot', reason: 'HOA liens sit on that same Jackson recorder search, which requires a login session this client will not use.' },
  { county: 'jackson', leadType: 'sheriff_sale', status: 'already_existed', reason: 'Jackson sale dates already come from the SouthLaw Missouri sales PDF inside county_public when an owner and situs match.' },
  { county: 'johnson', leadType: 'divorce', status: 'cannot', reason: 'Kansas Case Search blocked this client with Cloudflare and requires an in-browser terms step, so no divorce rows are fetched.' },
  { county: 'johnson', leadType: 'probate', status: 'already_existed', reason: 'Johnson probate stays on the existing deceased inheritance audience; Kansas Case Search is blocked and is not a second pipeline.' },
  { county: 'johnson', leadType: 'foreclosure_notice', status: 'already_existed', reason: 'Johnson mortgage filings already come from The Legal Record joined to SouthLaw when a situs exists.' },
  { county: 'johnson', leadType: 'lis_pendens', status: 'already_existed', reason: 'Legal Record MF rows that match a SouthLaw Johnson case are already imported as lis pendens on the notice path.' },
  { county: 'johnson', leadType: 'federal_tax_lien', status: 'cannot', reason: 'No stable unauthenticated Johnson County lien source was already obvious, and this pass does not add a recorder client.' },
  { county: 'johnson', leadType: 'hoa_lien', status: 'cannot', reason: 'No stable unauthenticated Johnson County HOA lien source was already obvious, and this pass does not add one.' },
  { county: 'johnson', leadType: 'sheriff_sale', status: 'already_existed', reason: 'Johnson sheriff sales already come from JoCo Sheriff GetAllSales joined to the SouthLaw Kansas PDF.' },
]

function deferred(county: 'clay' | 'wyandotte' | 'platte' | 'cass'): CoverageCell[] {
  const reason = county === 'cass' ? CASS : OUT_OF_PASS
  return COURT_LEAD_TYPES.map((leadType) => ({ county, leadType, status: 'cannot' as const, reason }))
}

export const COURT_FILING_COVERAGE: CoverageCell[] = [
  ...SCOPED,
  ...deferred('clay'),
  ...deferred('wyandotte'),
  ...deferred('platte'),
  ...deferred('cass'),
]

export function coverageCell(county: CourtCounty, leadType: CourtLeadType): CoverageCell {
  const cell = COURT_FILING_COVERAGE.find((row) => row.county === county && row.leadType === leadType)
  if (!cell) throw new Error(`Missing coverage for ${county} ${leadType}`)
  return cell
}

export function gapsForLane(lane: 'divorce' | 'lien'): CoverageCell[] {
  if (lane === 'divorce') return [coverageCell('jackson', 'divorce'), coverageCell('johnson', 'divorce')]
  return [
    coverageCell('jackson', 'federal_tax_lien'),
    coverageCell('jackson', 'hoa_lien'),
    coverageCell('johnson', 'federal_tax_lien'),
    coverageCell('johnson', 'hoa_lien'),
  ]
}
