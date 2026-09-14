import 'server-only'
import { z } from 'zod'
import { WorkflowError } from '../workflow/core'
export interface ReceivingProvider {
  get(secret: string, id: string): Promise<unknown>
}
export const receivingProvider: ReceivingProvider = {
  async get(secret, id) {
    if (!z.string().uuid().safeParse(id).success)
      throw new WorkflowError('REPLY_PROVIDER_ID_INVALID')
    let response: Response
    try {
      response = await fetch(`https://api.resend.com/emails/receiving/${id}`, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new WorkflowError('REPLY_PROVIDER_UNAVAILABLE', 503)
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new WorkflowError(
        response.status === 401 || response.status === 403
          ? 'REPLY_CONNECTION_REJECTED'
          : response.status === 404
            ? 'REPLY_NOT_READY'
            : response.status === 429
              ? 'REPLY_RATE_LIMIT'
              : 'REPLY_PROVIDER_UNAVAILABLE',
        503,
      )
    }
    const reader = response.body?.getReader()
    if (!reader) throw new WorkflowError('REPLY_PROVIDER_INVALID')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2097152) {
          await reader.cancel()
          throw new WorkflowError('REPLY_CONTENT_REVIEW_REQUIRED')
        }
        chunks.push(value)
      }
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      ) as unknown
    } catch (error) {
      throw error instanceof WorkflowError
        ? error
        : new WorkflowError('REPLY_PROVIDER_INVALID')
    } finally {
      reader.releaseLock()
    }
  },
}
