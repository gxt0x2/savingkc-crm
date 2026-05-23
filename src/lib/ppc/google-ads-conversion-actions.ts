import { cleanJsonRecord, type PpcConversionEventName } from '@/lib/ppc/conversion-outbox'
import {
  getGoogleAdsAccessToken,
  readGoogleAdsConfig,
  type GoogleAdsConfig,
} from '@/lib/ppc/conversion-exporter'

type Env = Record<string, string | undefined>

export type GoogleAdsConversionActionSummary = {
  id: string
  resourceName: string
  name: string
  type: string
  status: string
  customerId: string
}

export type GoogleAdsConversionActionSuggestion = {
  eventName: PpcConversionEventName
  envKey: string
  action: GoogleAdsConversionActionSummary | null
}

export type GoogleAdsConversionActionInspection = {
  ok: boolean
  configured: boolean
  missingConfig: string[]
  customerId: string | null
  loginCustomerId: string | null
  actions: GoogleAdsConversionActionSummary[]
  suggestedMappings: GoogleAdsConversionActionSuggestion[]
}

type SearchStreamResponse = Array<{
  results?: Array<{
    conversionAction?: {
      id?: string
      resourceName?: string
      name?: string
      type?: string
      status?: string
    }
  }>
}>

const CONVERSION_ACTION_QUERY = `
  SELECT
    conversion_action.id,
    conversion_action.resource_name,
    conversion_action.name,
    conversion_action.type,
    conversion_action.status
  FROM conversion_action
  WHERE conversion_action.status != 'REMOVED'
  ORDER BY conversion_action.name
`

function digits(value: string | null | undefined): string | null {
  const onlyDigits = value?.replace(/\D/g, '') ?? ''
  return onlyDigits || null
}

function envKey(eventName: PpcConversionEventName): string {
  return `GOOGLE_ADS_CONVERSION_ACTION_${eventName.toUpperCase()}`
}

function isEnabled(action: GoogleAdsConversionActionSummary): boolean {
  return action.status === 'ENABLED'
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function findAction(
  actions: GoogleAdsConversionActionSummary[],
  eventName: PpcConversionEventName,
): GoogleAdsConversionActionSummary | null {
  const uploadType = eventName.startsWith('call_connected_') ? 'UPLOAD_CALLS' : 'UPLOAD_CLICKS'
  const candidates = actions.filter((action) => action.type === uploadType && isEnabled(action))

  const normalized = candidates.map((action) => ({ action, name: normalizeName(action.name) }))

  const exactPatterns: Partial<Record<PpcConversionEventName, RegExp[]>> = {
    qualified_lead: [/search 2026.*qualified.*lead/, /qualified.*lead/],
    appointment_booked: [/search 2026.*appointment.*book/, /appointment.*book/, /appointment.*set/],
    call_connected_60s: [/search 2026.*call.*(60|1 min|1 minute|60s)/, /call.*(60|1 min|1 minute|60s)/],
    call_connected_2m: [/search 2026.*call.*(2 min|2 minute|120|2m)/, /call.*(2 min|2 minute|120|2m)/],
    call_connected_5m: [/search 2026.*call.*(5 min|5 minute|300|5m)/, /call.*(5 min|5 minute|300|5m)/],
    lead_submitted: [/search 2026.*lead.*form.*submit/, /lead.*form.*submit/, /lead.*submit/],
  }

  for (const pattern of exactPatterns[eventName] ?? []) {
    const match = normalized.find(({ name }) => pattern.test(name))
    if (match) return match.action
  }

  return null
}

function suggestedMappings(actions: GoogleAdsConversionActionSummary[]): GoogleAdsConversionActionSuggestion[] {
  const eventNames: PpcConversionEventName[] = [
    'qualified_lead',
    'appointment_booked',
    'call_connected_60s',
    'call_connected_2m',
    'call_connected_5m',
  ]

  return eventNames.map((eventName) => ({
    eventName,
    envKey: envKey(eventName),
    action: findAction(actions, eventName),
  }))
}

function summarizeRemoteError(body: Record<string, unknown>, fallback: string): string {
  const error = body.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return fallback
}

function toActionSummary(
  customerId: string,
  conversionAction: NonNullable<NonNullable<SearchStreamResponse[number]['results']>[number]['conversionAction']>,
): GoogleAdsConversionActionSummary | null {
  const id = String(conversionAction.id || '').trim()
  const resourceName = String(conversionAction.resourceName || '').trim()
  const name = String(conversionAction.name || '').trim()
  if (!id || !resourceName || !name) return null

  return {
    id,
    resourceName,
    name,
    type: String(conversionAction.type || 'UNKNOWN'),
    status: String(conversionAction.status || 'UNKNOWN'),
    customerId,
  }
}

async function searchConversionActionsForCustomer(
  config: GoogleAdsConfig,
  accessToken: string,
  customerId: string,
  fetchFn: typeof fetch,
): Promise<GoogleAdsConversionActionSummary[]> {
  const response = await fetchFn(
    `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: cleanJsonRecord({
        'Content-Type': 'application/json',
        'developer-token': config.developerToken,
        'Authorization': `Bearer ${accessToken}`,
        'login-customer-id': config.loginCustomerId ?? undefined,
      }) as HeadersInit,
      body: JSON.stringify({ query: CONVERSION_ACTION_QUERY }),
    },
  )

  const body = await response.json().catch(() => ({})) as SearchStreamResponse | Record<string, unknown>
  if (!response.ok) {
    throw new Error(summarizeRemoteError(body as Record<string, unknown>, `Google Ads conversion action search failed (${response.status})`))
  }

  if (!Array.isArray(body)) return []

  return body.flatMap((chunk) =>
    (chunk.results ?? [])
      .map((result) => result.conversionAction ? toActionSummary(customerId, result.conversionAction) : null)
      .filter((action): action is GoogleAdsConversionActionSummary => Boolean(action)),
  )
}

export async function inspectGoogleAdsConversionActions(
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleAdsConversionActionInspection> {
  const { config, missing } = readGoogleAdsConfig(env)
  if (!config) {
    return {
      ok: false,
      configured: false,
      missingConfig: missing,
      customerId: digits(env.GOOGLE_ADS_CUSTOMER_ID ?? null),
      loginCustomerId: digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? env.GOOGLE_ADS_MANAGER_CUSTOMER_ID ?? null),
      actions: [],
      suggestedMappings: suggestedMappings([]),
    }
  }

  const accessToken = await getGoogleAdsAccessToken(config, fetchFn)
  const customerIds = Array.from(new Set([config.customerId, config.loginCustomerId].filter(Boolean))) as string[]
  const actions = (await Promise.all(
    customerIds.map((customerId) => searchConversionActionsForCustomer(config, accessToken, customerId, fetchFn)),
  )).flat()

  return {
    ok: true,
    configured: true,
    missingConfig: [],
    customerId: config.customerId,
    loginCustomerId: config.loginCustomerId,
    actions,
    suggestedMappings: suggestedMappings(actions),
  }
}
