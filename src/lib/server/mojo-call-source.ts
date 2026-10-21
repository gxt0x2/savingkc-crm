import {
  mapOfficialListCall,
  mapRecordingReportRow,
  type MojoCallListPage,
  type MojoCallSource,
} from './mojo-call-ledger'

export const MOJO_MCP_RESOURCE = 'https://mcp.mojosells.com/mcp'
export const MOJO_MCP_TOKEN_ENDPOINT = 'https://mcp.mojosells.com/oauth/token'
export const MOJO_RECORDING_REPORT_PATH = '/v2/rest/reports/call-recording-report-data/'

/**
 * Server-side access to Mojo's read-only MCP is OAuth 2.1, not the scraper cookie.
 *
 * Discovery (public metadata, scope mcp:calls.read only):
 * - Resource: https://mcp.mojosells.com/mcp
 * - Authorization server: https://mcp.mojosells.com/oauth
 * - Authorize: https://mcp.mojosells.com/oauth/authorize
 * - Token: https://mcp.mojosells.com/oauth/token
 * - Register: https://mcp.mojosells.com/oauth/register
 * - Grant types: authorization_code and refresh_token
 * - PKCE: S256
 * - Token endpoint auth: client_secret_post or client_secret_basic
 * - Bearer usage: Authorization header
 *
 * The CRM can call list_calls once the owner stores either a short-lived
 * MOJO_MCP_ACCESS_TOKEN, or all three of MOJO_MCP_CLIENT_ID,
 * MOJO_MCP_CLIENT_SECRET, and MOJO_MCP_REFRESH_TOKEN from that OAuth flow.
 * The browser sessionid cookie used by the activity scraper is not an MCP
 * credential and is not sent to mcp.mojosells.com.
 */
export const MOJO_MCP_AUTH_REQUIREMENTS = {
  resource: MOJO_MCP_RESOURCE,
  authorizationServer: 'https://mcp.mojosells.com/oauth',
  authorizationEndpoint: 'https://mcp.mojosells.com/oauth/authorize',
  tokenEndpoint: MOJO_MCP_TOKEN_ENDPOINT,
  registrationEndpoint: 'https://mcp.mojosells.com/oauth/register',
  scope: 'mcp:calls.read',
  grantTypes: ['authorization_code', 'refresh_token'],
  codeChallengeMethod: 'S256',
  tokenEndpointAuthMethods: ['client_secret_post', 'client_secret_basic'],
  bearer: 'Authorization header',
  durableServerEnv: ['MOJO_MCP_CLIENT_ID', 'MOJO_MCP_CLIENT_SECRET', 'MOJO_MCP_REFRESH_TOKEN'],
  optionalAccessTokenEnv: 'MOJO_MCP_ACCESS_TOKEN',
  notAccepted: 'MOJO sessionid cookie',
} as const

export type MojoMcpCredentialState = {
  mode: 'access_token' | 'refresh_token' | 'missing'
  missing: string[]
}

export function mojoMcpCredentialState(env: NodeJS.ProcessEnv = process.env): MojoMcpCredentialState {
  if (env.MOJO_MCP_ACCESS_TOKEN?.trim()) return { mode: 'access_token', missing: [] }
  const missing = MOJO_MCP_AUTH_REQUIREMENTS.durableServerEnv.filter((key) => !env[key]?.trim())
  if (missing.length === 0) return { mode: 'refresh_token', missing: [] }
  return { mode: 'missing', missing: [MOJO_MCP_AUTH_REQUIREMENTS.optionalAccessTokenEnv, ...missing] }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function createOfficialMojoCallSource(options: {
  accessToken?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  endpoint?: string
}): MojoCallSource {
  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = options.endpoint ?? MOJO_MCP_RESOURCE
  const env = options.env ?? process.env
  let accessToken = options.accessToken ?? env.MOJO_MCP_ACCESS_TOKEN?.trim() ?? ''
  let sessionId = ''
  let ready = false

  return {
    kind: 'mojo_mcp_list_calls',
    async listCalls(query) {
      if (!accessToken) accessToken = await refreshMojoMcpAccessToken(env, fetchImpl)
      if (!ready) {
        sessionId = await initializeMojoMcp(endpoint, accessToken, fetchImpl)
        ready = true
      }
      const page = positiveInt(query.page, 1)
      const pageSize = Math.min(positiveInt(query.pageSize, 100), 500)
      const message = await mcpToolCall(endpoint, accessToken, sessionId, fetchImpl, {
        name: 'list_calls',
        arguments: {
          date_from: query.dateFrom,
          date_to: query.dateTo,
          page,
          page_size: pageSize,
        },
      })
      return pageFromListCalls(message, page)
    },
  }
}

export function createSessionRecordingCallSource(options: {
  sessionId: string
  baseUrl?: string
  fetchImpl?: FetchLike
}): MojoCallSource {
  if (!options.sessionId.trim()) throw new Error('mojo_session_required')
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = (options.baseUrl ?? 'https://app71.mojosells.com').replace(/\/$/, '')
  const cache = new Map<string, { calls: ReturnType<typeof mapRecordingReportRow>[]; skippedUnkeyed: number }>()

  return {
    kind: 'mojo_session_recordings',
    async listCalls(query) {
      const key = `${query.dateFrom}:${query.dateTo}`
      let cached = cache.get(key)
      if (!cached) {
        const url = `${baseUrl}${MOJO_RECORDING_REPORT_PATH}?agents=%5B-1%5D&date_range=custom&from=${encodeURIComponent(query.dateFrom)}&to=${encodeURIComponent(query.dateTo)}`
        const response = await fetchImpl(url, {
          headers: {
            accept: 'application/json, text/plain, */*',
            cookie: `sessionid=${options.sessionId}`,
            referer: `${baseUrl}/`,
          },
        })
        if (response.status === 401 || response.status === 403) throw new Error('session_expired')
        if (!response.ok) throw new Error(`mojo_recording_report_${response.status}`)
        const payload = await response.json() as { recordings?: unknown }
        if (!Array.isArray(payload.recordings)) throw new Error('invalid_mojo_recording_report')
        const calls = []
        let skippedUnkeyed = 0
        for (const row of payload.recordings) {
          const mapped = mapRecordingReportRow(row)
          if (!mapped) skippedUnkeyed += 1
          else calls.push(mapped)
        }
        cached = { calls, skippedUnkeyed }
        cache.set(key, cached)
      }
      const page = positiveInt(query.page, 1)
      const pageSize = Math.min(positiveInt(query.pageSize, 100), 500)
      const start = (page - 1) * pageSize
      return {
        totalCount: cached.calls.length,
        totalPages: Math.max(1, Math.ceil(cached.calls.length / pageSize)),
        page,
        results: cached.calls.slice(start, start + pageSize).filter((row): row is NonNullable<typeof row> => row != null),
        skippedUnkeyed: page === 1 ? cached.skippedUnkeyed : 0,
      }
    },
  }
}

export function createMojoCallSource(options: {
  env?: NodeJS.ProcessEnv
  sessionId?: string | null
  fetchImpl?: FetchLike
  baseUrl?: string
} = {}): { source: MojoCallSource | null; auth: MojoMcpCredentialState } {
  const env = options.env ?? process.env
  const auth = mojoMcpCredentialState(env)
  if (auth.mode !== 'missing') {
    return { source: createOfficialMojoCallSource({ env, fetchImpl: options.fetchImpl }), auth }
  }
  if (options.sessionId?.trim()) {
    return {
      source: createSessionRecordingCallSource({
        sessionId: options.sessionId,
        fetchImpl: options.fetchImpl,
        baseUrl: options.baseUrl,
      }),
      auth,
    }
  }
  return { source: null, auth }
}

async function refreshMojoMcpAccessToken(env: NodeJS.ProcessEnv, fetchImpl: FetchLike): Promise<string> {
  const refreshToken = env.MOJO_MCP_REFRESH_TOKEN?.trim() ?? ''
  const clientId = env.MOJO_MCP_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.MOJO_MCP_CLIENT_SECRET?.trim() ?? ''
  if (!refreshToken || !clientId || !clientSecret) throw new Error('mojo_mcp_credentials_missing')
  const response = await fetchImpl(MOJO_MCP_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!response.ok) throw new Error(`mojo_mcp_token_refresh_${response.status}`)
  const payload = await response.json() as { access_token?: unknown }
  if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
    throw new Error('mojo_mcp_token_refresh_missing_access_token')
  }
  return payload.access_token.trim()
}

async function initializeMojoMcp(endpoint: string, accessToken: string, fetchImpl: FetchLike): Promise<string> {
  const initialized = await mcpPost(endpoint, accessToken, '', fetchImpl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'savingkc-crm', version: 'mojo-call-ledger' },
    },
  })
  await mcpPost(endpoint, accessToken, initialized.sessionId, fetchImpl, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  })
  return initialized.sessionId
}

async function mcpToolCall(
  endpoint: string,
  accessToken: string,
  sessionId: string,
  fetchImpl: FetchLike,
  params: { name: string; arguments: Record<string, string | number> },
): Promise<unknown> {
  const response = await mcpPost(endpoint, accessToken, sessionId, fetchImpl, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params,
  })
  const message = response.messages.find((item) => item && typeof item === 'object' && 'result' in (item as Record<string, unknown>))
    ?? response.messages[0]
  if (!message || typeof message !== 'object') throw new Error('mojo_mcp_empty_response')
  const record = message as Record<string, unknown>
  if (record.error) throw new Error('mojo_mcp_tool_error')
  return record.result ?? record
}

async function mcpPost(endpoint: string, accessToken: string, sessionId: string, fetchImpl: FetchLike, body: unknown): Promise<{
  messages: unknown[]
  sessionId: string
}> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const response = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  if (response.status === 401 || response.status === 403) throw new Error('mojo_mcp_unauthorized')
  if (!response.ok && response.status !== 202) throw new Error(`mojo_mcp_http_${response.status}`)
  const text = await response.text()
  return {
    messages: text.trim() ? parseMcpMessages(text, response.headers.get('content-type') || '') : [],
    sessionId: response.headers.get('mcp-session-id') || sessionId,
  }
}

export function parseMcpMessages(body: string, contentType: string): unknown[] {
  if (!contentType.includes('text/event-stream')) {
    return [JSON.parse(body) as unknown]
  }
  return body.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()) as unknown)
}

export function pageFromListCalls(message: unknown, page: number): MojoCallListPage {
  const payload = unwrapToolResult(message)
  if (!payload || !Array.isArray(payload.results) || typeof payload.total_count !== 'number') {
    throw new Error('invalid_mojo_call_page')
  }
  return {
    totalCount: payload.total_count,
    totalPages: typeof payload.total_pages === 'number' ? payload.total_pages : 1,
    page: typeof payload.page === 'number' ? payload.page : page,
    results: payload.results.map((row) => mapOfficialListCall(row)),
    skippedUnkeyed: 0,
  }
}

function unwrapToolResult(message: unknown): { results?: unknown; total_count?: unknown; total_pages?: unknown; page?: unknown } | null {
  if (!message || typeof message !== 'object') return null
  const record = message as Record<string, unknown>
  if (Array.isArray(record.content)) {
    const text = record.content.find((item) => item && typeof item === 'object' && (item as { type?: string }).type === 'text') as { text?: string } | undefined
    if (typeof text?.text === 'string') return JSON.parse(text.text) as { results?: unknown; total_count?: unknown; total_pages?: unknown; page?: unknown }
  }
  if (record.structuredContent && typeof record.structuredContent === 'object') {
    return record.structuredContent as { results?: unknown; total_count?: unknown; total_pages?: unknown; page?: unknown }
  }
  return record as { results?: unknown; total_count?: unknown; total_pages?: unknown; page?: unknown }
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || value == null || value < 1) return fallback
  return value
}
