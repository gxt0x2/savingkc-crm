export type PpcTrackingAttributionRow = {
  traffic_source: string | null
  campaign: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  gad_source: string | null
  gad_campaignid: string | null
  gad_adgroupid: string | null
  page_path: string | null
  page_location: string | null
  page_referrer: string | null
  payload: Record<string, unknown> | null
  event_time: string | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function clean(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

export function attributionFromTrackingRow(
  row: PpcTrackingAttributionRow | null | undefined,
): Record<string, unknown> {
  if (!row) return {}
  const payload = record(row.payload)
  return clean({
    ...record(payload.attribution),
    ...payload,
    traffic_source: row.traffic_source,
    campaign: row.campaign,
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    utm_term: row.utm_term,
    utm_content: row.utm_content,
    gclid: row.gclid,
    gbraid: row.gbraid,
    wbraid: row.wbraid,
    gad_source: row.gad_source,
    gad_campaignid: row.gad_campaignid,
    gad_adgroupid: row.gad_adgroupid,
    page_path: row.page_path,
    page_location: row.page_location,
    page_referrer: row.page_referrer,
    landingUrl: row.page_location,
    referrer: row.page_referrer,
  })
}

export function attributionFromTrackingRows(
  rows: PpcTrackingAttributionRow[] | null | undefined,
): Record<string, unknown> {
  return [...(rows ?? [])]
    .reverse()
    .reduce<Record<string, unknown>>(
      (attribution, row) => ({ ...attribution, ...attributionFromTrackingRow(row) }),
      {},
    )
}
