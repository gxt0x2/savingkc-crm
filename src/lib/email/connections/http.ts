import 'server-only'
import type { WorkflowHttpDependencies } from '../workflow/http'
import { sameOrigin, workflowErrorResponse } from '../workflow/http'
import { WorkflowError } from '../workflow/core'
import { connectService, disconnectService, readConnections } from './service'
import {
  recheckConnection,
  reviewConnectionReplacement,
  rotateCredentialSecrets,
  saveWebhookEndpoint,
} from './lifecycle'
import { credentialKeyring } from '../secrets'

/** Dedicated credential endpoint: never log request bodies or provider errors. */
export function createConnectionHttp(dependencies: WorkflowHttpDependencies) {
  return {
    async GET(request: Request) {
      try {
        const subject = await dependencies.subject(request)
        if (!subject) throw new WorkflowError('SIGN_IN_REQUIRED', 401)
        return Response.json(
          await readConnections(dependencies.database(), subject),
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      } catch (error) {
        return workflowErrorResponse(error)
      }
    },
    async POST(request: Request) {
      return mutate(request, 'connect')
    },
    async PATCH(request: Request) {
      return mutate(request, 'lifecycle')
    },
    async DELETE(request: Request) {
      return mutate(request, 'disconnect')
    },
  }
  async function mutate(
    request: Request,
    mode: 'connect' | 'disconnect' | 'lifecycle',
  ) {
    try {
      if (!sameOrigin(request)) throw new WorkflowError('INVALID_ORIGIN', 403)
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        throw new WorkflowError('JSON_REQUIRED', 415)
      const subject = await dependencies.subject(request)
      if (!subject) throw new WorkflowError('SIGN_IN_REQUIRED', 401)
      const text = await request.text()
      if (text.length > 4096) throw new WorkflowError('COMMAND_TOO_LARGE', 413)
      let input: unknown
      try {
        input = JSON.parse(text)
      } catch {
        throw new WorkflowError('INVALID_JSON', 400)
      }
      if (mode === 'lifecycle') await applyLifecycle(subject, input)
      const result =
        mode === 'connect'
          ? await connectService(dependencies.database(), subject, input)
          : mode === 'disconnect'
            ? await disconnectService(dependencies.database(), subject, input)
            : await readConnections(dependencies.database(), subject)
      return Response.json(result, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    } catch (error) {
      return workflowErrorResponse(error)
    }
  }
  async function applyLifecycle(subject: string, raw: unknown) {
    const body =
      raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
    const action = String(body.action ?? '')
    delete body.action
    const sql = dependencies.database()
    if (action === 'rotate_credentials')
      return rotateCredentialSecrets(sql, subject, body, credentialKeyring())
    if (action === 'save_webhook') return saveWebhookEndpoint(sql, subject, body)
    if (action === 'review_replacement')
      return reviewConnectionReplacement(sql, subject, body)
    if (action === 'recheck') return recheckConnection(sql, subject, body)
    throw new WorkflowError('INVALID_CONNECTION', 400)
  }
}
