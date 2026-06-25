export type MarketingPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'qtr' | 'ytd'

export type KpiItem = {
  lab: string
  val: number
  fmt: 'usd' | 'num' | 'k'
  delta: number
  good: boolean
}

export type SeriesRow = {
  date?: string
  hour?: number
  label: string
  spend: number
  cpl: number
  clicks: number
  leads: number
  qualified: number
  conversions: number
}

export type CampaignRow = {
  name: string
  source?: string
  leads: number
  clicks?: number
  spend: number
  call: number
  form: number
  sms: number
  color: string
}

export type KeywordRow = {
  kw: string
  campaign: string
  clicks: number
  leads: number
  cpl: number
  qual: number
}

export type NegativeKeywordRow = KeywordRow & {
  status: 'active' | 'suggested'
}

export type FunnelRow = {
  name: string
  n: number
  c: string
  breakdownLabel: string
  breakdown: FunnelBreakdownRow[]
}

export type FunnelBreakdownRow = {
  label: string
  value: number
  color: string
  note?: string
}

export type CallBreakdownRow = {
  label: string
  value: number
  color: string
  details: FunnelBreakdownRow[]
}

export type StageRow = {
  key: string
  name: string
  icon: IconName
}

export type LeadRow = {
  id: string | number
  name: string
  source?: string
  county: string
  prop: string
  campaign: string
  kw: string
  land: string
  progress: number
  score: number
  verdict: 'FAVORITE' | 'WATCH' | 'FOOL'
  spread: number
  days: number
  dials: number
  connects: number
  talk: number
  spend: number
  ts0: string
}

export type OutboxRow = {
  id: string
  leadId: string | number | null
  leadName: string
  source?: string
  event: string
  category: string
  status: string
  approved: boolean
  role: string
  clickId: string
  clickIdType: string
  campaign: string
  keyword: string
  value: number
  attempts: number
  lastError: string | null
  dryRun: boolean
  exportable: boolean
  approvalRequired: boolean
  exportNote: string | null
  sentAt: string | null
  eventTime: string
  ageDays: number
}

export type ExportHealth = {
  total: number
  pending: number
  sent: number
  skipped: number
  failed: number
  repairedKnownSkips: number
  lastSuccessfulExport: string | null
  lastSuccessfulEvent: string | null
  lastSuccessfulLead: string | null
  lastFailureReason: string | null
  lastFailureAt: string | null
  lastFailureEvent: string | null
  status: 'clean' | 'watch' | 'attention'
}

export type OpenAIAdsHealth = {
  status: 'clean' | 'watch' | 'attention'
  message: string
  pixelConfigured: boolean
  serverApiConfigured: boolean
  reportingApiConfigured: boolean
  syncStatus: string | null
  lastSyncAt: string | null
  lastError: string | null
  latestCampaignImportAt: string | null
  campaignRows: number
  trackingEvents: number
  leads: number
  pendingExports: number
  sentExports: number
  failedExports: number
}

export type MojoHealth = {
  status: 'clean' | 'watch' | 'attention'
  message: string
  sessionStatus: string
  syncHealth: string
  businessHours: boolean
  lastSyncAt: string | null
  lastSyncAgeMinutes: number | null
  lastSessionOkAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  latestQueuedAt: string | null
  latestCompletedAt: string | null
  latestQueueError: string | null
  queue: {
    pending: number
    processing: number
    completed24h: number
    failed24h: number
    deadLetter: number
    queued24h: number
    total7d: number
  }
  leads: {
    last24h: number
    period: number
    qualifiedPeriod: number
    appointmentPeriod: number
  }
  monitor: {
    path: string
    schedule: string
    manualRefreshCommand: string
  }
}

export type MicroStepRow = {
  key: string
  name: string
  icon: IconName
}

export type PaidSessionRow = {
  id: string
  time: string
  date: 'today' | 'yesterday' | string
  dateL: string
  source?: string
  campaign: string
  gclid: string
  kw: string
  sub: string
  timeline?: string
  condition?: string
  auctionStatus?: string
  contactFields?: string[]
  land: string
  progress: number
  converted: boolean
  leadId: string | number | null
  drop: keyof typeof DROP_LABEL | null
  city: string
  device: string
  ref: string
  loadMs: number
  durationSec?: number
  scrollDepth?: number
}

export type IconName =
  | 'eye'
  | 'cursor'
  | 'page'
  | 'bolt'
  | 'spark'
  | 'phone'
  | 'chat'
  | 'check'
  | 'cal'
  | 'doc'
  | 'sign'
  | 'flag'
  | 'home'
  | 'pin'
  | 'user'
  | 'exit'
  | 'scroll'
  | 'sun'
  | 'moon'

export const KPI: KpiItem[] = [
  { lab: 'Impressions', val: 18420, fmt: 'num', delta: 9.4, good: true },
  { lab: 'Clicks', val: 612, fmt: 'num', delta: 12.4, good: true },
  { lab: 'Leads', val: 47, fmt: 'num', delta: 15.0, good: true },
  { lab: 'Qualified', val: 19, fmt: 'num', delta: 5.6, good: true },
  { lab: 'Cost / Lead', val: 89.7, fmt: 'usd', delta: -6.1, good: true },
  { lab: 'Cost / Deal', val: 1406, fmt: 'usd', delta: -11.3, good: true },
  { lab: 'Pipeline Assignment Value', val: 312000, fmt: 'k', delta: 22.0, good: true },
]

export const SERIES: SeriesRow[] = (() => {
  const rows: SeriesRow[] = []
  const d = new Date()
  d.setDate(d.getDate() - 149)
  const base = [
    110, 95, 140, 160, 120, 80, 70, 150, 170, 130, 90, 75, 145, 168, 155,
    100, 82, 160, 175, 140, 95, 78, 150, 180, 165, 110, 88, 170, 190, 158,
  ]

  for (let i = 0; i < 150; i += 1) {
    const drift = 1 + (i - 149) * 0.0015
    const spend = Math.round((base[i % 30] + Math.round(Math.sin(i) * 8)) * drift)
    const clicks = Math.round(spend / 6.9)
    const leads = Math.max(0, Math.round(spend / 95 + (i % 4 === 0 ? 1 : 0) - (i % 7 === 0 ? 1 : 0)))
    const qualified = Math.max(0, Math.round(leads * 0.4))
    const conversions = Math.max(leads, leads + (i % 3 === 0 ? 1 : 0))
    rows.push({
      date: d.toISOString(),
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      spend,
      cpl: leads > 0 ? Math.round(spend / leads) : 0,
      clicks,
      leads,
      qualified,
      conversions,
    })
    d.setDate(d.getDate() + 1)
  }

  return rows
})()

export function hourlySeries(dayOffset = 0): SeriesRow[] {
  const rows: SeriesRow[] = []
  const hourMult = [
    0.4, 0.3, 0.2, 0.2, 0.3, 0.5, 0.8, 1.2, 1.6, 1.9, 2.1, 2.0,
    1.8, 1.7, 1.8, 1.9, 2.0, 1.8, 1.4, 1.0, 0.8, 0.7, 0.6, 0.5,
  ]

  for (let hour = 0; hour < 24; hour += 1) {
    const m = hourMult[hour]
    const spend = Math.round(7 * m + (dayOffset ? 2 : 0))
    const clicks = Math.round((spend / 6.9) * 10) / 10
    const leads = Math.max(0, Math.round(m * 0.6 - (dayOffset ? 0.2 : 0)))
    const qualified = Math.max(0, Math.round(leads * 0.4))
    rows.push({
      hour,
      label: `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`,
      spend,
      cpl: leads > 0 ? Math.round(spend / leads) : 0,
      clicks: Math.round(clicks),
      leads,
      qualified,
      conversions: leads,
    })
  }

  return rows
}

export const CAMPAIGNS: CampaignRow[] = [
  { name: 'Tax Delinquent — KC Metro', source: 'Google Ads', leads: 16, spend: 1480, call: 7, form: 8, sms: 1, color: '#f87171' },
  { name: 'Inherited / Probate', source: 'Google Ads', leads: 11, spend: 1010, call: 5, form: 5, sms: 1, color: '#22c55e' },
  { name: 'Tired Landlords', source: 'Google Ads', leads: 9, spend: 760, call: 4, form: 4, sms: 1, color: '#eab308' },
  { name: 'Cash Offer — Sell Fast', source: 'Google Ads', leads: 7, spend: 640, call: 2, form: 4, sms: 1, color: '#60a5fa' },
  { name: 'Vacant / Distressed', source: 'Google Ads', leads: 4, spend: 328, call: 1, form: 3, sms: 0, color: '#c02626' },
]

export const KEYWORDS: KeywordRow[] = [
  { kw: 'sell my house fast kansas city', campaign: 'Cash Offer — Sell Fast', clicks: 142, leads: 12, cpl: 79, qual: 58 },
  { kw: 'we buy houses kc', campaign: 'Tax Delinquent — KC Metro', clicks: 118, leads: 9, cpl: 84, qual: 44 },
  { kw: 'sell inherited house missouri', campaign: 'Inherited / Probate', clicks: 76, leads: 8, cpl: 71, qual: 62 },
  { kw: 'tax delinquent property help', campaign: 'Tax Delinquent — KC Metro', clicks: 64, leads: 7, cpl: 68, qual: 71 },
  { kw: 'sell rental property kc', campaign: 'Tired Landlords', clicks: 58, leads: 5, cpl: 96, qual: 40 },
  { kw: 'cash for my house overland park', campaign: 'Cash Offer — Sell Fast', clicks: 49, leads: 3, cpl: 131, qual: 33 },
  { kw: 'how to sell a vacant house', campaign: 'Vacant / Distressed', clicks: 41, leads: 2, cpl: 148, qual: 50 },
]

export const NEGATIVES: NegativeKeywordRow[] = [
  { kw: 'free house', campaign: 'All Campaigns', clicks: 38, leads: 0, cpl: 0, qual: 0, status: 'active' },
  { kw: 'rent to own homes kc', campaign: 'Tired Landlords', clicks: 51, leads: 0, cpl: 0, qual: 0, status: 'active' },
  { kw: 'zillow', campaign: 'All Campaigns', clicks: 44, leads: 1, cpl: 0, qual: 0, status: 'active' },
  { kw: 'real estate agent jobs', campaign: 'All Campaigns', clicks: 29, leads: 0, cpl: 0, qual: 0, status: 'suggested' },
  { kw: 'how to become a wholesaler', campaign: 'Cash Offer — Sell Fast', clicks: 33, leads: 0, cpl: 0, qual: 0, status: 'suggested' },
]

export const FUNNEL: FunnelRow[] = [
  {
    name: 'Impressions',
    n: 18420,
    c: '#2563eb',
    breakdownLabel: 'Campaign impression mix',
    breakdown: [
      { label: 'Tax Delinquent — KC Metro', value: 6200, color: '#2563eb', note: 'Highest auction volume' },
      { label: 'Inherited / Probate', value: 4100, color: '#22c55e' },
      { label: 'Cash Offer — Sell Fast', value: 3600, color: '#60a5fa' },
      { label: 'Tired Landlords', value: 2850, color: '#eab308' },
      { label: 'Vacant / Distressed', value: 1670, color: '#f87171' },
    ],
  },
  {
    name: 'Clicks',
    n: 612,
    c: '#3b82f6',
    breakdownLabel: 'Click intent mix',
    breakdown: [
      { label: 'Back taxes', value: 247, color: '#3b82f6', note: 'Tax delinquent query path' },
      { label: 'Inherited', value: 149, color: '#22c55e' },
      { label: 'Fast cash offer', value: 112, color: '#60a5fa' },
      { label: 'Tired landlord', value: 65, color: '#eab308' },
      { label: 'Vacant/distressed', value: 39, color: '#f87171' },
    ],
  },
  {
    name: 'Situation',
    n: 286,
    c: '#14b8a6',
    breakdownLabel: 'Situation answers',
    breakdown: [
      { label: 'Back taxes', value: 142, color: '#14b8a6', note: 'Selected tax/back-tax situation' },
      { label: 'Inherited', value: 84, color: '#22c55e' },
      { label: 'Tired landlord', value: 41, color: '#eab308' },
      { label: 'Vacant or repairs', value: 19, color: '#f87171' },
    ],
  },
  {
    name: 'Condition',
    n: 198,
    c: '#06b6d4',
    breakdownLabel: 'Condition answers',
    breakdown: [
      { label: 'Move-in ready', value: 116, color: '#06b6d4' },
      { label: 'Needs work', value: 38, color: '#22c55e' },
      { label: 'Major repairs', value: 27, color: '#eab308' },
      { label: 'Vacant', value: 17, color: '#f87171' },
    ],
  },
  {
    name: 'Timeline',
    n: 142,
    c: '#22c55e',
    breakdownLabel: 'Seller timeline',
    breakdown: [
      { label: 'ASAP', value: 63, color: '#22c55e' },
      { label: '30-60 days', value: 44, color: '#60a5fa' },
      { label: 'Researching', value: 26, color: '#eab308' },
      { label: 'No clear timeline', value: 9, color: '#f87171' },
    ],
  },
  {
    name: 'Address',
    n: 88,
    c: '#16a34a',
    breakdownLabel: 'Address capture quality',
    breakdown: [
      { label: 'Matched property', value: 61, color: '#16a34a', note: 'Address normalized to parcel' },
      { label: 'Partial address', value: 18, color: '#eab308' },
      { label: 'Out of area', value: 6, color: '#f87171' },
      { label: 'Manual review', value: 3, color: '#60a5fa' },
    ],
  },
  {
    name: 'Leads',
    n: 47,
    c: '#15803d',
    breakdownLabel: 'Lead creation path',
    breakdown: [
      { label: 'Form submit', value: 28, color: '#15803d' },
      { label: 'Phone call', value: 14, color: '#22c55e' },
      { label: 'SMS / chat', value: 5, color: '#60a5fa' },
    ],
  },
  {
    name: 'Qualified',
    n: 19,
    c: '#166534',
    breakdownLabel: 'Qualified lead reason',
    breakdown: [
      { label: 'High motivation', value: 8, color: '#166534' },
      { label: 'Equity confirmed', value: 5, color: '#22c55e' },
      { label: 'Tax pressure', value: 4, color: '#3b82f6' },
      { label: 'Appointment set', value: 2, color: '#eab308' },
    ],
  },
]

export const CALL_BREAKDOWN: CallBreakdownRow[] = [
  {
    label: 'Back taxes',
    value: 7,
    color: '#14b8a6',
    details: [
      { label: 'Tax delinquent property help', value: 4, color: '#14b8a6' },
      { label: 'we buy houses kc', value: 2, color: '#3b82f6' },
      { label: 'direct phone tap', value: 1, color: '#60a5fa' },
    ],
  },
  {
    label: 'Inherited',
    value: 5,
    color: '#22c55e',
    details: [
      { label: 'sell inherited house missouri', value: 3, color: '#22c55e' },
      { label: 'probate house buyer', value: 1, color: '#16a34a' },
      { label: 'estate seller callback', value: 1, color: '#86efac' },
    ],
  },
  {
    label: 'Tired landlord',
    value: 4,
    color: '#eab308',
    details: [
      { label: 'sell rental property kc', value: 2, color: '#eab308' },
      { label: 'tenant damage', value: 1, color: '#facc15' },
      { label: 'vacancy pressure', value: 1, color: '#fde047' },
    ],
  },
  {
    label: 'Fast cash offer',
    value: 2,
    color: '#60a5fa',
    details: [
      { label: 'sell my house fast kansas city', value: 1, color: '#60a5fa' },
      { label: 'cash offer overland park', value: 1, color: '#93c5fd' },
    ],
  },
  {
    label: 'Vacant / repairs',
    value: 1,
    color: '#f87171',
    details: [
      { label: 'how to sell a vacant house', value: 1, color: '#f87171' },
    ],
  },
]

export const STAGES: StageRow[] = [
  { key: 'impression', name: 'Ad Impression', icon: 'eye' },
  { key: 'click', name: 'Keyword Click', icon: 'cursor' },
  { key: 'landing', name: 'Landing Page', icon: 'page' },
  { key: 'conversion', name: 'Conversion', icon: 'bolt' },
  { key: 'new', name: 'New Lead', icon: 'spark' },
  { key: 'attempt', name: 'Attempted', icon: 'phone' },
  { key: 'connected', name: 'Connected', icon: 'chat' },
  { key: 'qualified', name: 'Qualified', icon: 'check' },
  { key: 'appt', name: 'Appointment', icon: 'cal' },
  { key: 'offer', name: 'Offer Made', icon: 'doc' },
  { key: 'contract', name: 'Under Contract', icon: 'sign' },
  { key: 'closed', name: 'Closed / Assigned', icon: 'flag' },
]

export const LEADS: LeadRow[] = [
  { id: 1, name: 'Marcus Whitfield', county: 'Jackson Co · MO', prop: 'Inherited SFR', campaign: 'Inherited / Probate', kw: 'sell inherited house missouri', land: '/call', progress: 10, score: 88, verdict: 'FAVORITE', spread: 42000, days: 14, dials: 9, connects: 4, talk: 31, spend: 71, ts0: 'Mar 12' },
  { id: 2, name: 'Estate of D. Reyes', county: 'Wyandotte Co · KS', prop: 'Tax Delinquent Land', campaign: 'Tax Delinquent — KC Metro', kw: 'tax delinquent property help', land: '/guide', progress: 11, score: 79, verdict: 'FAVORITE', spread: 38500, days: 22, dials: 12, connects: 6, talk: 48, spend: 68, ts0: 'Mar 4' },
  { id: 3, name: 'Janelle Cooper', county: 'Clay Co · MO', prop: 'Tired Landlord 4-plex', campaign: 'Tired Landlords', kw: 'sell rental property kc', land: '/call', progress: 7, score: 72, verdict: 'FAVORITE', spread: 55000, days: 6, dials: 5, connects: 2, talk: 18, spend: 96, ts0: 'Mar 20' },
  { id: 4, name: 'Robert Tann', county: 'Johnson Co · KS', prop: 'Vacant SFR', campaign: 'Cash Offer — Sell Fast', kw: 'cash for my house overland park', land: '/call', progress: 5, score: 51, verdict: 'WATCH', spread: 28000, days: 3, dials: 3, connects: 1, talk: 6, spend: 131, ts0: 'Mar 23' },
  { id: 5, name: 'Gloria Mendez', county: 'Jackson Co · MO', prop: 'Distressed SFR', campaign: 'Vacant / Distressed', kw: 'how to sell a vacant house', land: '/guide', progress: 8, score: 64, verdict: 'FAVORITE', spread: 33000, days: 9, dials: 6, connects: 3, talk: 22, spend: 148, ts0: 'Mar 17' },
  { id: 6, name: 'The Okafor Trust', county: 'Platte Co · MO', prop: 'Inherited SFR', campaign: 'Inherited / Probate', kw: 'sell inherited house missouri', land: '/call', progress: 6, score: 69, verdict: 'FAVORITE', spread: 47000, days: 5, dials: 4, connects: 2, talk: 14, spend: 71, ts0: 'Mar 21' },
  { id: 7, name: 'Dwayne Ellis', county: 'Jackson Co · MO', prop: 'Tired Landlord Duplex', campaign: 'Tired Landlords', kw: 'sell rental property kc', land: '/call', progress: 4, score: 38, verdict: 'FOOL', spread: 19000, days: 2, dials: 2, connects: 0, talk: 0, spend: 96, ts0: 'Mar 24' },
  { id: 8, name: 'Patricia Vaughn', county: 'Johnson Co · KS', prop: 'Tax Delinquent SFR', campaign: 'Tax Delinquent — KC Metro', kw: 'we buy houses kc', land: '/call', progress: 9, score: 81, verdict: 'FAVORITE', spread: 61000, days: 11, dials: 8, connects: 4, talk: 37, spend: 84, ts0: 'Mar 15' },
  { id: 9, name: 'Carl Hutchins', county: 'Clay Co · MO', prop: 'Vacant SFR', campaign: 'Cash Offer — Sell Fast', kw: 'sell my house fast kansas city', land: '/call', progress: 3, score: 44, verdict: 'WATCH', spread: 24000, days: 1, dials: 0, connects: 0, talk: 0, spend: 79, ts0: 'Mar 25' },
]

export const OUTBOX: OutboxRow[] = [
  { id: 'ob01', leadId: 2, leadName: 'Estate of D. Reyes', event: 'Qualified Lead', category: 'form', status: 'Awaiting approval', approved: false, role: 'primary', clickId: 'CjwKCAjw8u_q9zABwE', clickIdType: 'gclid', campaign: 'Search 2026', keyword: 'we buy houses kc', value: 25000, attempts: 0, lastError: null, dryRun: false, exportable: true, approvalRequired: true, exportNote: null, sentAt: null, eventTime: new Date().toISOString(), ageDays: 0 },
  { id: 'ob02', leadId: 3, leadName: 'Janelle Cooper', event: 'Lead Submitted', category: 'form', status: 'Website/GTM only', approved: false, role: 'secondary', clickId: 'Cj0KCQjwz9_tiredwcB', clickIdType: 'gclid', campaign: 'Search 2026', keyword: 'sell rental property kc', value: 0, attempts: 1, lastError: null, dryRun: false, exportable: false, approvalRequired: false, exportNote: 'Tracked by website/GTM primary conversion', sentAt: new Date().toISOString(), eventTime: new Date(Date.now() - 86_400_000).toISOString(), ageDays: 1 },
]

export const EXPORT_HEALTH: ExportHealth = {
  total: OUTBOX.length,
  pending: 1,
  sent: 0,
  skipped: 1,
  failed: 0,
  repairedKnownSkips: 0,
  lastSuccessfulExport: null,
  lastSuccessfulEvent: null,
  lastSuccessfulLead: null,
  lastFailureReason: null,
  lastFailureAt: null,
  lastFailureEvent: null,
  status: 'watch',
}

export const OPENAI_ADS_HEALTH: OpenAIAdsHealth = {
  status: 'watch',
  message: 'Waiting for live OpenAI Ads reporting data.',
  pixelConfigured: true,
  serverApiConfigured: true,
  reportingApiConfigured: true,
  syncStatus: 'waiting',
  lastSyncAt: null,
  lastError: null,
  latestCampaignImportAt: null,
  campaignRows: 0,
  trackingEvents: 0,
  leads: 0,
  pendingExports: 0,
  sentExports: 0,
  failedExports: 0,
}

export const MOJO_HEALTH: MojoHealth = {
  status: 'watch',
  message: 'Waiting for live Mojo health data',
  sessionStatus: 'unknown',
  syncHealth: 'unknown',
  businessHours: false,
  lastSyncAt: null,
  lastSyncAgeMinutes: null,
  lastSessionOkAt: null,
  lastError: null,
  lastErrorAt: null,
  latestQueuedAt: null,
  latestCompletedAt: null,
  latestQueueError: null,
  queue: {
    pending: 0,
    processing: 0,
    completed24h: 0,
    failed24h: 0,
    deadLetter: 0,
    queued24h: 0,
    total7d: 0,
  },
  leads: {
    last24h: 0,
    period: 0,
    qualifiedPeriod: 0,
    appointmentPeriod: 0,
  },
  monitor: {
    path: '/api/admin/mojo-health',
    schedule: 'Every 15 minutes during Mojo business hours',
    manualRefreshCommand: 'npm run mojo:session:manual',
  },
}

export const MICRO_STEPS: MicroStepRow[] = [
  { key: 'click', name: 'Ad Click', icon: 'cursor' },
  { key: 'land', name: 'Landing', icon: 'page' },
  { key: 'engage', name: 'Page Engagement', icon: 'scroll' },
  { key: 'situation', name: 'Situation', icon: 'spark' },
  { key: 'timeline', name: 'Timeline', icon: 'cal' },
  { key: 'condition', name: 'Condition', icon: 'home' },
  { key: 'contact', name: 'Contact Info', icon: 'user' },
  { key: 'submit', name: 'Submit', icon: 'bolt' },
]

export const PAID_SESSIONS: PaidSessionRow[] = [
  { id: 'pc01', time: '6:23 PM', date: 'today', dateL: 'Today', campaign: 'Search 2026', gclid: 'EAIaIQobChMI8u__BwE', kw: 'tax delinquent property help', sub: 'Tax Delinquent', land: '/sell-fast/tax-delinquent', progress: 4, converted: false, leadId: null, drop: 'tab_away', city: 'Independence, MO', device: 'iPhone 15 · Safari', ref: 'google.com/search', loadMs: 1840 },
  { id: 'pc02', time: '1:47 PM', date: 'today', dateL: 'Today', campaign: 'Search 2026', gclid: 'CjwKCAjw8u_q9k_BwE', kw: 'tax delinquent property help', sub: 'Tax Delinquent', land: '/sell-fast/tax-delinquent', progress: 6, converted: false, leadId: null, drop: 'rage_click', city: "Lee's Summit, MO", device: 'Android · Chrome', ref: 'google.com/search', loadMs: 2210 },
  { id: 'pc03', time: '8:34 AM', date: 'today', dateL: 'Today', campaign: 'Search 2026', gclid: 'CjwKCAjw8u_q9zABwE', kw: 'we buy houses kc', sub: 'Tax Delinquent', land: '/sell-fast/tax-delinquent', progress: 8, converted: true, leadId: 2, drop: null, city: 'Kansas City, KS', device: 'MacBook · Chrome', ref: 'google.com/search', loadMs: 1620 },
  { id: 'pc04', time: '1:45 PM', date: 'today', dateL: 'Today', campaign: 'Search 2026', gclid: 'Cj0KCQjwz9_h2k_wcB', kw: 'sell my house fast kansas city', sub: 'Tax Delinquent', land: '/sell-fast/tax-delinquent', progress: 3, converted: false, leadId: null, drop: 'back', city: 'Blue Springs, MO', device: 'iPhone 14 · Safari', ref: 'google.com/search', loadMs: 1990 },
  { id: 'pc05', time: '12:53 PM', date: 'today', dateL: 'Today', campaign: 'Search 2026', gclid: 'Cj0KCQjwz9_h2yAwcB', kw: 'sell inherited house missouri', sub: 'Inherited', land: '/sell-fast/inherited', progress: 5, converted: false, leadId: null, drop: 'idle', city: 'Overland Park, KS', device: 'iPad · Safari', ref: 'google.com/search', loadMs: 1450 },
  { id: 'pc06', time: '11:15 AM', date: 'today', dateL: 'Today', campaign: 'Search 2026', gclid: 'Cj0KCQjwz9_tiredwcB', kw: 'sell rental property kc', sub: 'Tired Landlords', land: '/sell-fast/tired-landlord', progress: 8, converted: true, leadId: 3, drop: null, city: 'North Kansas City, MO', device: 'Windows · Chrome', ref: 'google.com/search', loadMs: 1730 },
  { id: 'pc07', time: '10:42 AM', date: 'today', dateL: 'Today', campaign: 'Search 2026', gclid: 'EAIaIQobChMIxz_BwE', kw: 'sell inherited house missouri', sub: 'Inherited', land: '/sell-fast/inherited', progress: 7, converted: false, leadId: null, drop: 'invalid_phone', city: 'Belton, MO', device: 'iPhone 13 · Safari', ref: 'google.com/search', loadMs: 2080 },
  { id: 'pc08', time: '9:18 AM', date: 'today', dateL: 'Today', campaign: 'Search 2026', gclid: 'EAIaIQobChMI_q9zBwE', kw: 'cash for my house overland park', sub: 'Cash Offer', land: '/sell-fast/cash-offer', progress: 2, converted: false, leadId: null, drop: 'close', city: 'Olathe, KS', device: 'Android · Chrome', ref: 'google.com/search', loadMs: 2540 },
  { id: 'pc09', time: '8:47 PM', date: 'yesterday', dateL: 'Yesterday', campaign: 'Search 2026', gclid: 'Cj0KCQjwz9vacWcB', kw: 'how to sell a vacant house', sub: 'Vacant / Distressed', land: '/sell-fast/vacant', progress: 10, converted: true, leadId: 5, drop: null, city: 'Raytown, MO', device: 'iPhone 15 · Safari', ref: 'google.com/search', loadMs: 1580 },
  { id: 'pc10', time: '5:12 PM', date: 'yesterday', dateL: 'Yesterday', campaign: 'Search 2026', gclid: 'Cj0KCQjwzABCwcB', kw: 'tax delinquent property help', sub: 'Tax Delinquent', land: '/sell-fast/tax-delinquent', progress: 8, converted: false, leadId: null, drop: 'scroll_bottom', city: 'Grandview, MO', device: 'Android · Chrome', ref: 'google.com/search', loadMs: 1910 },
  { id: 'pc11', time: '3:30 PM', date: 'yesterday', dateL: 'Yesterday', campaign: 'Search 2026', gclid: 'EAIaIQobChMIinhWxz', kw: 'sell inherited house missouri', sub: 'Inherited', land: '/sell-fast/inherited', progress: 4, converted: false, leadId: null, drop: 'tab_away', city: 'Shawnee, KS', device: 'iPad · Safari', ref: 'google.com/search', loadMs: 1670 },
  { id: 'pc12', time: '11:02 AM', date: 'yesterday', dateL: 'Yesterday', campaign: 'Search 2026', gclid: 'CjwKCAjwcashWcB', kw: 'cash for my house overland park', sub: 'Cash Offer', land: '/sell-fast/cash-offer', progress: 6, converted: false, leadId: null, drop: 'close', city: 'Mission, KS', device: 'Windows · Edge', ref: 'google.com/search', loadMs: 2330 },
]

export const DROP_LABEL = {
  tab_away: { h: 'Tab Lost Focus', d: 'Switched to another tab · idle 18s · session ended' },
  rage_click: { h: 'Rage-clicked Submit', d: 'Hit submit 3x while validation failing · abandoned' },
  back: { h: 'Pressed Back', d: 'Returned to Google search results' },
  idle: { h: 'Session Timeout', d: 'Page idle 65s with no interaction' },
  invalid_phone: { h: 'Invalid Phone Entry', d: 'Typed phone in wrong format · saw error · closed' },
  close: { h: 'Closed Tab', d: 'Closed the browser tab · low engagement' },
  scroll_bottom: { h: 'Scrolled to Footer', d: 'Skimmed FAQ · idled 12s · left' },
} as const
