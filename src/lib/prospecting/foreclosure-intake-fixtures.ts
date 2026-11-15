import type { IntakeReviewRow } from '@/lib/prospecting/foreclosure-intake'

/** Sample review rows for non-production previews. They are not seller records. */
export function foreclosureIntakeReviewFixtures(): IntakeReviewRow[] {
  return [
    {
      id: 'f7220000-0000-4000-8000-0000000000a1',
      demo: true,
      sourceName: 'Case.net',
      sourceUrl: 'https://example.com/casenet/sandbox-notice',
      timeline: [{ date: '2026-11-01', source: 'Case.net', stage: 'Lis Pendens', sale_date: null, url: 'https://example.com/casenet/sandbox-notice' }],
      saleDate: null,
      county: 'jackson',
      state: 'MO',
      ownerName: 'Sample Homeowner',
      trusteeOrFirm: 'Sample Trustee',
      equityBand: null,
      reviewStatus: 'pending',
    },
    {
      id: 'f7220000-0000-4000-8000-0000000000a2',
      demo: true,
      sourceName: 'Johnson and Wyandotte sheriff lists',
      sourceUrl: 'https://example.com/sheriff/sandbox-sale',
      timeline: [
        { date: '2026-10-01', source: 'Johnson and Wyandotte sheriff lists', stage: 'Sheriff sale', sale_date: '2026-11-20', url: 'https://example.com/sheriff/sandbox-sale' },
        { date: '2026-11-02', source: 'Johnson and Wyandotte sheriff lists', stage: 'Sheriff sale', sale_date: '2026-12-04', url: 'https://example.com/sheriff/sandbox-sale' },
      ],
      saleDate: '2026-12-04',
      county: 'johnson',
      state: 'KS',
      ownerName: 'Sample Defendant',
      trusteeOrFirm: 'Sample Sheriff',
      equityBand: null,
      reviewStatus: 'pending',
    },
  ]
}
