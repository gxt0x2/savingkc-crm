import { mobileConfig } from '../config'
import type {
  CallIntentAllowedResponse,
  CallIntentKind,
  CallIntentResponse,
  CallOutcome,
  ConversationDetailResponse,
  ConversationsResponse,
  ConversationThread,
  CrmLead,
  LeadDetailResponse,
  LeadsResponse,
  MobileSession,
  VoiceTokenResponse,
} from '../types'

type ApiOptions = {
  accessToken?: string | null
  signal?: AbortSignal
}

export class CrmApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
  }
}

export async function fetchLeads(options: ApiOptions = {}): Promise<CrmLead[]> {
  if (!mobileConfig.crmApiBaseUrl) {
    throw new CrmApiError('CRM API base URL is not configured.')
  }

  const response = await fetch(`${mobileConfig.crmApiBaseUrl}/api/mobile/v1/leads?limit=25`, {
    headers: {
      Accept: 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    signal: options.signal,
  })

  let payload: LeadsResponse | null = null
  try {
    payload = (await response.json()) as LeadsResponse
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CrmApiError(payload?.error || `CRM API request failed (${response.status}).`, response.status)
  }

  return Array.isArray(payload?.leads) ? payload.leads : []
}

export async function fetchMobileSession(options: ApiOptions = {}): Promise<MobileSession> {
  if (!mobileConfig.crmApiBaseUrl) {
    throw new CrmApiError('CRM API base URL is not configured.')
  }

  const response = await fetch(`${mobileConfig.crmApiBaseUrl}/api/mobile/v1/session`, {
    headers: {
      Accept: 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    signal: options.signal,
  })

  const payload = (await response.json().catch(() => null)) as (MobileSession & { error?: string }) | null
  if (!response.ok) {
    throw new CrmApiError(payload?.error || `Session check failed (${response.status}).`, response.status)
  }

  if (!payload) throw new CrmApiError('Session response was empty.')
  return payload
}

export async function fetchLeadDetail(leadId: string, options: ApiOptions = {}): Promise<LeadDetailResponse> {
  if (!mobileConfig.crmApiBaseUrl) {
    throw new CrmApiError('CRM API base URL is not configured.')
  }

  const response = await fetch(`${mobileConfig.crmApiBaseUrl}/api/mobile/v1/leads/${leadId}`, {
    headers: {
      Accept: 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    signal: options.signal,
  })

  const payload = (await response.json().catch(() => null)) as LeadDetailResponse | null
  if (!response.ok) {
    throw new CrmApiError(payload?.error || `CRM API request failed (${response.status}).`, response.status)
  }

  return payload || {}
}

export async function logCallEvent(input: {
  accessToken: string
  leadId: string
  phone: string
  event: 'started' | 'ended'
  durationSeconds?: number
  outcome?: CallOutcome
  disposition?: string
  clientCallId?: string
}) {
  if (!mobileConfig.crmApiBaseUrl) {
    throw new CrmApiError('CRM API base URL is not configured.')
  }

  const response = await fetch(`${mobileConfig.crmApiBaseUrl}/api/mobile/v1/calls/events`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      leadId: input.leadId,
      phone: input.phone,
      event: input.event,
      durationSeconds: input.durationSeconds,
      outcome: input.outcome,
      disposition: input.disposition,
      clientCallId: input.clientCallId,
    }),
  })

  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) {
    throw new CrmApiError(payload?.error || `Call event failed (${response.status}).`, response.status)
  }

  return payload
}

async function mobileRequest<T>(path: string, options: ApiOptions & { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  if (!mobileConfig.crmApiBaseUrl) throw new CrmApiError('CRM API base URL is not configured.')
  const response = await fetch(`${mobileConfig.crmApiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null
  if (!response.ok) throw new CrmApiError(payload?.error || `CRM API request failed (${response.status}).`, response.status)
  if (!payload) throw new CrmApiError('CRM API returned an empty response.')
  return payload
}

export async function fetchConversations(options: ApiOptions = {}): Promise<ConversationThread[]> {
  const payload = await mobileRequest<ConversationsResponse>('/api/mobile/v1/conversations', options)
  return Array.isArray(payload.items) ? payload.items : []
}

export async function fetchConversationDetail(leadId: string, options: ApiOptions = {}): Promise<ConversationDetailResponse> {
  return mobileRequest<ConversationDetailResponse>(`/api/mobile/v1/conversations/${leadId}`, options)
}

export async function sendMobileMessage(input: { accessToken: string; leadId: string; channel: 'sms' | 'email'; body: string; subject?: string }) {
  return mobileRequest<{ success: boolean; channel: 'sms' | 'email'; sent?: boolean; from?: string }>('/api/mobile/v1/messages', {
    accessToken: input.accessToken,
    method: 'POST',
    body: input,
  })
}

export async function fetchVoiceToken(options: ApiOptions = {}): Promise<VoiceTokenResponse> {
  return mobileRequest<VoiceTokenResponse>('/api/mobile/v1/twilio/token', options)
}

export async function requestMobileCallIntent(input: {
  accessToken: string
  phone: string
  callerId: string
  kind: CallIntentKind
  leadId?: string | null
  prospectPhoneId?: string | null
  clientAttemptId: string
}): Promise<CallIntentAllowedResponse> {
  const payload = await mobileRequest<CallIntentResponse>('/api/mobile/v1/twilio/call-intents', {
    accessToken: input.accessToken,
    method: 'POST',
    body: {
      phone: input.phone,
      callerId: input.callerId,
      kind: input.kind,
      leadId: input.leadId ?? null,
      prospectPhoneId: input.prospectPhoneId ?? null,
      clientAttemptId: input.clientAttemptId,
    },
  })
  if (!payload.allowed) throw new CrmApiError(payload.error || payload.reason || 'This call is not allowed.')
  if (!payload.intent || !payload.to || !payload.callerId || !payload.clientAttemptId) {
    throw new CrmApiError('Call authorization returned an incomplete response.')
  }
  return payload
}
