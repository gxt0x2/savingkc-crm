import 'server-only'
import { Resend } from 'resend'
import { check, WorkflowError } from '../workflow/core'

export const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024
// A verifier only: this client never makes a provider request.
const verifier = new Resend('verification-only')
export async function readWebhookBody(request: Request) {
  const length = request.headers.get('content-length')
  check(
    !length || (/^\d+$/.test(length) && Number(length) <= MAX_WEBHOOK_BYTES),
    'WEBHOOK_TOO_LARGE',
    413,
  )
  check(request.body, 'INVALID_WEBHOOK', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_WEBHOOK_BYTES) {
        await reader.cancel()
        throw new WorkflowError('WEBHOOK_TOO_LARGE', 413)
      }
      chunks.push(value)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    )
  } finally {
    reader.releaseLock()
  }
}
export function verifyResendWebhook(
  raw: string,
  headers: Headers,
  secret: string,
) {
  const id = headers.get('svix-id'),
    timestamp = headers.get('svix-timestamp'),
    signature = headers.get('svix-signature')
  check(
    id &&
      id.length <= 200 &&
      timestamp &&
      signature &&
      signature.length <= 4096,
    'INVALID_WEBHOOK_SIGNATURE',
    401,
  )
  try {
    return {
      id,
      payload: verifier.webhooks.verify({
        payload: raw,
        headers: { id, timestamp, signature },
        webhookSecret: secret,
      }) as unknown,
    }
  } catch {
    throw new WorkflowError('INVALID_WEBHOOK_SIGNATURE', 401)
  }
}
