export type LandingHeatmapEventRow = {
  id?: string | null
  event_id: string
  event_name: string
  event_category: string | null
  event_time: string
  session_id: string | null
  visitor_id: string | null
  lead_id: string | null
  page_path: string | null
  page_location: string | null
  campaign: string | null
  form_step: number | null
  payload: Record<string, unknown> | null
}

export type LandingHeatmapItem = {
  key: string
  label: string
  section: string
  pageKey: string
  pageLabel: string
  count: number
  sessions: number
  leads: number
  lastSeenAt: string | null
  detailCompleteness: 'specific' | 'generic'
}

export type LandingHeatmapSection = {
  key: string
  label: string
  pageKey: string
  pageLabel: string
  count: number
  sessions: number
  leads: number
  lastSeenAt: string | null
  intensity: number
  topEventNames: Array<{ eventName: string; count: number }>
}

export type LandingHeatmapVideo = LandingHeatmapItem & {
  starts: number
  progress25: number
  progress50: number
  progress75: number
  completes: number
  maxPercent: number
}

export type LandingHeatmapPage = {
  pageKey: string
  pageLabel: string
  events: number
  sessions: number
  leads: number
  specificityRate: number
  topEventNames: Array<{ eventName: string; count: number }>
  sections: LandingHeatmapSection[]
  faqs: LandingHeatmapItem[]
  ctas: LandingHeatmapItem[]
  showMe: LandingHeatmapItem[]
  videos: LandingHeatmapVideo[]
}

export type LandingHeatmapReport = {
  generatedAt: string
  days: number
  since: string
  until: string
  pageFilter: string
  summary: {
    events: number
    sessions: number
    leads: number
    pages: number
    specificEvents: number
    genericEvents: number
    specificityRate: number
  }
  pages: LandingHeatmapPage[]
  genericEvents: Array<{ eventName: string; count: number; examplePage: string }>
}

type MutableItem = Omit<LandingHeatmapItem, 'sessions' | 'leads'> & {
  sessionIds: Set<string>
  leadIds: Set<string>
}

type MutableSection = Omit<LandingHeatmapSection, 'sessions' | 'leads' | 'intensity' | 'topEventNames'> & {
  sessionIds: Set<string>
  leadIds: Set<string>
  eventNames: Map<string, number>
}

type MutableVideo = Omit<LandingHeatmapVideo, 'sessions' | 'leads'> & {
  sessionIds: Set<string>
  leadIds: Set<string>
}

type MutablePage = {
  pageKey: string
  pageLabel: string
  events: number
  sessionIds: Set<string>
  leadIds: Set<string>
  specificEvents: number
  genericEvents: number
  eventNames: Map<string, number>
  sections: Map<string, MutableSection>
  faqs: Map<string, MutableItem>
  ctas: Map<string, MutableItem>
  showMe: Map<string, MutableItem>
  videos: Map<string, MutableVideo>
}

const IMPORTANT_EVENT_NAMES = new Set([
  'faq_opened',
  'faq_click',
  'cta_click',
  'nav_click',
  'show_me_clicked',
  'show_me_click',
  'video_started',
  'video_play',
  'video_progress',
  'video_progress_25',
  'video_progress_50',
  'video_progress_75',
  'video_completed',
  'video_paused',
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function titleize(value: string): string {
  return value
    .replace(/^\/+/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function pathnameFrom(value: string | null): string {
  const raw = text(value)
  if (!raw) return ''
  if (raw.startsWith('/')) return raw.split('?')[0] || '/'
  try {
    return new URL(raw).pathname || '/'
  } catch {
    return raw.split('?')[0] || ''
  }
}

function pageFrom(row: LandingHeatmapEventRow): { key: string; label: string } {
  const payload = record(row.payload)
  const path = pathnameFrom(row.page_path)
    || pathnameFrom(text(payload.page_path) || text(payload.pagePath) || null)
    || pathnameFrom(row.page_location)
  if (path.startsWith('/ppc-tax')) return { key: '/ppc-tax', label: 'PPC Tax' }
  if (path.startsWith('/ppc')) return { key: '/ppc', label: 'PPC' }
  if (path.startsWith('/deals') || path.startsWith('/deal-pages')) return { key: '/deals', label: 'Deal Pages' }
  if (path) return { key: path, label: titleize(path) || 'Other Page' }
  return { key: 'unknown', label: 'Unknown Page' }
}

function pageMatches(pageKey: string, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'deals') return pageKey === '/deals'
  return pageKey === filter
}

function sessionKey(row: LandingHeatmapEventRow): string {
  return text(row.session_id) || text(row.visitor_id) || text(row.event_id)
}

function sectionLabel(row: LandingHeatmapEventRow): string {
  const payload = record(row.payload)
  const direct = text(payload.section)
    || text(payload.section_id)
    || text(payload.sectionId)
    || text(payload.page_section)
    || text(payload.area)
    || text(payload.placement)
  if (direct) return titleize(direct)

  const eventName = row.event_name
  if (eventName === 'ppc_visit_started' || eventName === 'page_view') return 'Hero'
  if (eventName === 'scroll_depth_reached') return 'Scroll Depth'
  if (eventName === 'faq_opened' || eventName === 'faq_click') return 'FAQ'
  if (eventName === 'phone_click' || eventName === 'skc_phone_number_selected') return 'Phone'
  if (eventName === 'nav_click') return 'Navigation'
  if (eventName.includes('video')) return 'Video'
  if (row.form_step) return `Form Step ${row.form_step}`
  if (eventName.includes('form') || eventName.includes('lead_') || eventName.includes('selected')) return 'Form'
  return 'Other'
}

function itemLabel(payload: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = text(payload[key])
    if (value) return value
  }
  return fallback
}

function itemKey(label: string, eventName: string, pageKey: string): string {
  return `${pageKey}:${eventName}:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'generic'}`
}

function videoPercent(eventName: string, payload: Record<string, unknown>): number {
  const eventPercent = eventName.endsWith('_75')
    ? 75
    : eventName.endsWith('_50')
      ? 50
      : eventName.endsWith('_25')
        ? 25
        : eventName === 'video_completed'
          ? 100
          : 0
  const raw = numberValue(payload.percent)
    ?? numberValue(payload.watch_percent)
    ?? numberValue(payload.watchPercent)
    ?? numberValue(payload.progress)
    ?? eventPercent
  return Math.max(0, Math.min(100, Math.round(raw)))
}

function hasAny(payload: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => Boolean(text(payload[key])))
}

function isSpecific(row: LandingHeatmapEventRow): boolean {
  const payload = record(row.payload)
  const eventName = row.event_name
  if (eventName === 'faq_opened' || eventName === 'faq_click') {
    return hasAny(payload, ['faq_id', 'faqId', 'faq_question', 'question', 'label'])
  }
  if (eventName === 'cta_click') {
    return hasAny(payload, ['cta_id', 'ctaId', 'cta_label', 'label', 'button_text', 'destination'])
  }
  if (eventName === 'nav_click') {
    return hasAny(payload, ['nav_id', 'navId', 'nav_label', 'label', 'destination', 'href'])
  }
  if (eventName === 'show_me_clicked' || eventName === 'show_me_click') {
    return hasAny(payload, ['item_id', 'itemId', 'item_label', 'label', 'target', 'issue'])
  }
  if (eventName.includes('video')) {
    return hasAny(payload, ['video_id', 'videoId', 'video_title', 'title', 'placement'])
  }
  if (eventName === 'scroll_depth_reached') {
    return numberValue(payload.depth) !== null || numberValue(payload.percent) !== null || numberValue(payload.scroll_depth) !== null
  }
  if (eventName.endsWith('_selected')) return true
  return !IMPORTANT_EVENT_NAMES.has(eventName)
}

function touchItem(item: MutableItem, row: LandingHeatmapEventRow) {
  item.count += 1
  item.sessionIds.add(sessionKey(row))
  if (row.lead_id) item.leadIds.add(row.lead_id)
  if (!item.lastSeenAt || Date.parse(row.event_time) > Date.parse(item.lastSeenAt)) item.lastSeenAt = row.event_time
}

function touchSection(section: MutableSection, row: LandingHeatmapEventRow) {
  section.count += 1
  section.sessionIds.add(sessionKey(row))
  if (row.lead_id) section.leadIds.add(row.lead_id)
  section.eventNames.set(row.event_name, (section.eventNames.get(row.event_name) ?? 0) + 1)
  if (!section.lastSeenAt || Date.parse(row.event_time) > Date.parse(section.lastSeenAt)) section.lastSeenAt = row.event_time
}

function getItem(map: Map<string, MutableItem>, row: LandingHeatmapEventRow, page: MutablePage, label: string, section: string, specific: boolean): MutableItem {
  const key = itemKey(label, row.event_name, page.pageKey)
  const existing = map.get(key)
  if (existing) return existing
  const item: MutableItem = {
    key,
    label,
    section,
    pageKey: page.pageKey,
    pageLabel: page.pageLabel,
    count: 0,
    sessionIds: new Set(),
    leadIds: new Set(),
    lastSeenAt: null,
    detailCompleteness: specific ? 'specific' : 'generic',
  }
  map.set(key, item)
  return item
}

function getVideo(map: Map<string, MutableVideo>, row: LandingHeatmapEventRow, page: MutablePage, label: string, section: string, specific: boolean): MutableVideo {
  const key = itemKey(label, 'video', page.pageKey)
  const existing = map.get(key)
  if (existing) return existing
  const item: MutableVideo = {
    key,
    label,
    section,
    pageKey: page.pageKey,
    pageLabel: page.pageLabel,
    count: 0,
    sessionIds: new Set(),
    leadIds: new Set(),
    lastSeenAt: null,
    detailCompleteness: specific ? 'specific' : 'generic',
    starts: 0,
    progress25: 0,
    progress50: 0,
    progress75: 0,
    completes: 0,
    maxPercent: 0,
  }
  map.set(key, item)
  return item
}

function serializeItem(item: MutableItem): LandingHeatmapItem {
  return {
    ...item,
    sessions: item.sessionIds.size,
    leads: item.leadIds.size,
  }
}

function serializeVideo(item: MutableVideo): LandingHeatmapVideo {
  return {
    ...item,
    sessions: item.sessionIds.size,
    leads: item.leadIds.size,
  }
}

function sortItems<T extends { count: number; sessions: number; lastSeenAt: string | null; label: string }>(items: T[]): T[] {
  return items.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    if (b.sessions !== a.sessions) return b.sessions - a.sessions
    const timeDiff = Date.parse(b.lastSeenAt || '') - Date.parse(a.lastSeenAt || '')
    if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff
    return a.label.localeCompare(b.label)
  })
}

function topEventNames(eventNames: Map<string, number>, limit = 8): Array<{ eventName: string; count: number }> {
  return Array.from(eventNames.entries())
    .map(([eventName, count]) => ({ eventName, count }))
    .sort((a, b) => b.count - a.count || a.eventName.localeCompare(b.eventName))
    .slice(0, limit)
}

export function buildLandingPageHeatmapReport(input: {
  rows: LandingHeatmapEventRow[]
  days: number
  since: string
  until: string
  pageFilter?: string
  generatedAt?: string
}): LandingHeatmapReport {
  const filter = input.pageFilter || 'all'
  const pages = new Map<string, MutablePage>()
  const genericEvents = new Map<string, { count: number; examplePage: string }>()
  const totalSessionIds = new Set<string>()
  const totalLeadIds = new Set<string>()
  let specificEvents = 0
  let genericEventCount = 0

  for (const row of input.rows) {
    const pageInfo = pageFrom(row)
    if (!pageMatches(pageInfo.key, filter)) continue

    let page = pages.get(pageInfo.key)
    if (!page) {
      page = {
        pageKey: pageInfo.key,
        pageLabel: pageInfo.label,
        events: 0,
        sessionIds: new Set(),
        leadIds: new Set(),
        specificEvents: 0,
        genericEvents: 0,
        eventNames: new Map(),
        sections: new Map(),
        faqs: new Map(),
        ctas: new Map(),
        showMe: new Map(),
        videos: new Map(),
      }
      pages.set(pageInfo.key, page)
    }

    const session = sessionKey(row)
    const payload = record(row.payload)
    const section = sectionLabel(row)
    const specific = isSpecific(row)
    page.events += 1
    page.sessionIds.add(session)
    totalSessionIds.add(session)
    if (row.lead_id) {
      page.leadIds.add(row.lead_id)
      totalLeadIds.add(row.lead_id)
    }
    page.eventNames.set(row.event_name, (page.eventNames.get(row.event_name) ?? 0) + 1)

    if (specific) {
      page.specificEvents += 1
      specificEvents += 1
    } else {
      page.genericEvents += 1
      genericEventCount += 1
      const current = genericEvents.get(row.event_name)
      genericEvents.set(row.event_name, {
        count: (current?.count ?? 0) + 1,
        examplePage: current?.examplePage ?? pageInfo.label,
      })
    }

    const sectionKey = `${page.pageKey}:${section.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    let sectionRow = page.sections.get(sectionKey)
    if (!sectionRow) {
      sectionRow = {
        key: sectionKey,
        label: section,
        pageKey: page.pageKey,
        pageLabel: page.pageLabel,
        count: 0,
        sessionIds: new Set(),
        leadIds: new Set(),
        lastSeenAt: null,
        eventNames: new Map(),
      }
      page.sections.set(sectionKey, sectionRow)
    }
    touchSection(sectionRow, row)

    if (row.event_name === 'faq_opened' || row.event_name === 'faq_click') {
      const label = itemLabel(payload, ['faq_question', 'question', 'faq_label', 'label', 'faq_id', 'faqId'], 'Unknown FAQ')
      touchItem(getItem(page.faqs, row, page, label, section, specific), row)
    }

    if (row.event_name === 'cta_click' || row.event_name === 'nav_click') {
      const label = itemLabel(payload, ['cta_label', 'label', 'button_text', 'nav_label', 'destination', 'href', 'cta_id', 'nav_id'], row.event_name === 'nav_click' ? 'Unknown Nav Click' : 'Unknown CTA')
      touchItem(getItem(page.ctas, row, page, label, section, specific), row)
    }

    if (row.event_name === 'show_me_clicked' || row.event_name === 'show_me_click') {
      const label = itemLabel(payload, ['item_label', 'label', 'target', 'issue', 'item_id', 'itemId'], 'Unknown Show Me')
      touchItem(getItem(page.showMe, row, page, label, section, specific), row)
    }

    if (row.event_name.includes('video')) {
      const label = itemLabel(payload, ['video_title', 'title', 'video_id', 'videoId', 'placement'], 'Unknown Video')
      const video = getVideo(page.videos, row, page, label, section, specific)
      touchItem(video, row)
      const percent = videoPercent(row.event_name, payload)
      video.maxPercent = Math.max(video.maxPercent, percent)
      if (row.event_name === 'video_started' || row.event_name === 'video_play') video.starts += 1
      if (percent >= 25) video.progress25 += 1
      if (percent >= 50) video.progress50 += 1
      if (percent >= 75) video.progress75 += 1
      if (row.event_name === 'video_completed' || percent >= 100) video.completes += 1
    }
  }

  const serializedPages = Array.from(pages.values())
    .map((page) => {
      const maxSectionCount = Math.max(1, ...Array.from(page.sections.values()).map((section) => section.count))
      return {
        pageKey: page.pageKey,
        pageLabel: page.pageLabel,
        events: page.events,
        sessions: page.sessionIds.size,
        leads: page.leadIds.size,
        specificityRate: page.events ? Math.round((page.specificEvents / page.events) * 100) : 100,
        topEventNames: topEventNames(page.eventNames),
        sections: sortItems(Array.from(page.sections.values()).map((section) => ({
          key: section.key,
          label: section.label,
          pageKey: section.pageKey,
          pageLabel: section.pageLabel,
          count: section.count,
          sessions: section.sessionIds.size,
          leads: section.leadIds.size,
          lastSeenAt: section.lastSeenAt,
          intensity: Math.round((section.count / maxSectionCount) * 100),
          topEventNames: topEventNames(section.eventNames, 3),
        }))),
        faqs: sortItems(Array.from(page.faqs.values()).map(serializeItem)),
        ctas: sortItems(Array.from(page.ctas.values()).map(serializeItem)),
        showMe: sortItems(Array.from(page.showMe.values()).map(serializeItem)),
        videos: sortItems(Array.from(page.videos.values()).map(serializeVideo)),
      }
    })
    .sort((a, b) => b.events - a.events || a.pageLabel.localeCompare(b.pageLabel))

  const totalEvents = serializedPages.reduce((sum, page) => sum + page.events, 0)
  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    days: input.days,
    since: input.since,
    until: input.until,
    pageFilter: filter,
    summary: {
      events: totalEvents,
      sessions: totalSessionIds.size,
      leads: totalLeadIds.size,
      pages: serializedPages.length,
      specificEvents,
      genericEvents: genericEventCount,
      specificityRate: totalEvents ? Math.round((specificEvents / totalEvents) * 100) : 100,
    },
    pages: serializedPages,
    genericEvents: Array.from(genericEvents.entries())
      .map(([eventName, item]) => ({ eventName, count: item.count, examplePage: item.examplePage }))
      .sort((a, b) => b.count - a.count || a.eventName.localeCompare(b.eventName)),
  }
}
