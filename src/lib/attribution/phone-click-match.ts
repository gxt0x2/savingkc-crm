import type { PhoneClickMatch } from './inbound-attribution'

/** How far back a website phone tap can explain a call to the public number. */
export const PHONE_CLICK_WINDOW_MS = 10 * 60_000

export type PhoneClickRow = {
  session_id: string | null
  visitor_id: string | null
  traffic_source: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  gclid: string | null
  page_path: string | null
}

export type PhoneClickDecision =
  | { match: PhoneClickMatch; reason: 'single_session' }
  | { match: null; reason: 'no_clicks' | 'several_sessions' }

/**
 * A call is credited to a website visit only when exactly one session tapped
 * the number in the window. Zero or several sessions = no credit (G2).
 */
export function decidePhoneClickMatch(rows: PhoneClickRow[]): PhoneClickDecision {
  const sessions = new Map<string, PhoneClickRow>()
  for (const row of rows) {
    if (row.session_id && !sessions.has(row.session_id)) sessions.set(row.session_id, row)
  }
  if (sessions.size === 0) return { match: null, reason: 'no_clicks' }
  if (sessions.size > 1) return { match: null, reason: 'several_sessions' }
  const [sessionId, row] = [...sessions.entries()][0]
  const source = row.utm_source || (row.traffic_source && row.traffic_source !== 'direct' ? row.traffic_source : null)
  return {
    reason: 'single_session',
    match: {
      sessionId,
      visitorId: row.visitor_id,
      source,
      medium: row.utm_medium,
      campaign: row.utm_campaign,
      gclid: row.gclid,
      landingPage: row.page_path,
    },
  }
}
