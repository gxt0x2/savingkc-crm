import 'server-only'
import { WorkflowError } from '../workflow/core'

export type ConnectionCapabilities = {
  domainsRead: boolean
  receivingRead: boolean
  sendingVerified: false
}
export type ConnectionChecker = (
  secret: string,
) => Promise<ConnectionCapabilities>

/** Read access only; never sends, creates a domain, or stores received messages. */
export const checkResendConnection: ConnectionChecker = async (secret) => {
  for (const path of ['/domains?limit=1', '/emails/receiving?limit=1']) {
    let response: Response
    try {
      response = await fetch(`https://api.resend.com${path}`, {
        headers: { Authorization: `Bearer ${secret}` },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      throw new WorkflowError('SERVICE_UNREACHABLE', 503)
    }
    // Status is sufficient to check access. Do not ingest unrelated customer email.
    await response.body?.cancel()
    if (response.status === 401)
      throw new WorkflowError('SERVICE_KEY_INVALID', 400)
    if (response.status === 403)
      throw new WorkflowError('SERVICE_SCOPE_REQUIRED', 400)
    if (response.status === 429)
      throw new WorkflowError('SERVICE_RATE_LIMIT', 429)
    if (!response.ok) throw new WorkflowError('SERVICE_CHECK_FAILED', 503)
  }
  return { domainsRead: true, receivingRead: true, sendingVerified: false }
}
