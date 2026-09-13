import 'server-only'
import { z } from 'zod'
import { WorkflowError } from '../workflow/core'

const domainSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(253),
  status: z.string().max(80),
  capabilities: z.object({
    sending: z.string().max(40),
    receiving: z.string().max(40),
  }),
  records: z
    .array(
      z.object({
        record: z.string().max(80),
        name: z.string().max(512),
        type: z.string().max(20),
        value: z.string().max(8192),
        status: z.string().max(80),
        ttl: z.union([z.string().max(40), z.number()]).optional(),
        priority: z.number().optional(),
      }),
    )
    .max(40)
    .default([]),
})
export type ProviderDomain = z.infer<typeof domainSchema>
export interface DomainProvider {
  find(secret: string, name: string): Promise<ProviderDomain | null>
  create(secret: string, name: string): Promise<ProviderDomain>
  get(secret: string, id: string): Promise<ProviderDomain>
}
async function request(
  secret: string,
  path: string,
  body?: object,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`https://api.resend.com${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new WorkflowError(
      body ? 'DOMAIN_CREATE_UNCERTAIN' : 'DOMAIN_PROVIDER_UNAVAILABLE',
      503,
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new WorkflowError(
      body
        ? 'DOMAIN_CREATE_UNCERTAIN'
        : response.status === 401 || response.status === 403
          ? 'DOMAIN_CONNECTION_REJECTED'
          : 'DOMAIN_PROVIDER_UNAVAILABLE',
      503,
    )
  }
  // Read only a bounded response and parse an allowlisted subset; no provider errors are surfaced.
  const text = await response.text()
  if (text.length > 1000000)
    throw new WorkflowError('DOMAIN_RESPONSE_INVALID', 503)
  try {
    return JSON.parse(text)
  } catch {
    throw new WorkflowError('DOMAIN_RESPONSE_INVALID', 503)
  }
}
export const resendDomainProvider: DomainProvider = {
  async find(secret, name) {
    let after: string | undefined
    for (let page = 0; page < 3; page++) {
      const raw = await request(
        secret,
        `/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
      )
      const result = z
        .object({
          data: z
            .array(z.object({ id: z.string().uuid(), name: z.string() }))
            .max(100),
          has_more: z.boolean(),
        })
        .safeParse(raw)
      if (!result.success)
        throw new WorkflowError('DOMAIN_RESPONSE_INVALID', 503)
      const found = result.data.data.find((d) => d.name.toLowerCase() === name)
      if (found) return this.get(secret, found.id)
      if (!result.data.has_more) return null
      after = result.data.data.at(-1)?.id
      if (!after) throw new WorkflowError('DOMAIN_RESPONSE_INVALID', 503)
    }
    throw new WorkflowError('DOMAIN_LIST_INCOMPLETE', 409)
  },
  async get(secret, id) {
    if (!z.string().uuid().safeParse(id).success)
      throw new WorkflowError('INVALID_DOMAIN', 400)
    const result = domainSchema.safeParse(
      await request(secret, `/domains/${id}`),
    )
    if (!result.success || result.data.id !== id)
      throw new WorkflowError('DOMAIN_RESPONSE_INVALID', 503)
    return result.data
  },
  async create(secret, name) {
    const result = domainSchema.safeParse(
      await request(secret, '/domains', {
        name,
        region: 'us-east-1',
        capabilities: { sending: 'enabled', receiving: 'enabled' },
      }),
    )
    if (!result.success) throw new WorkflowError('DOMAIN_CREATE_UNCERTAIN', 503)
    return result.data
  },
}
