import { mobileConfig } from '../config'
import type { CallOutcome, CrmLead, LeadDetailResponse, LeadsResponse, MobileSession } from '../types'

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
