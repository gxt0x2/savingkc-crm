import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Sql } from 'postgres'
import { emailCommandSuccessSchema } from '../contracts'
import {
  executePilotCommand,
  getPilotReview,
  readPilotState,
  WorkflowError,
} from './service'

export interface WorkflowHttpDependencies {
  subject(request: Request): Promise<string | null>
  database(): Sql
  now?: () => Date
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    // Next development requests use an internal URL hostname; the browser's
    // Host header is the actual destination. Never trust x-forwarded-host here.
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      parsed.host === (request.headers.get('host') ?? new URL(request.url).host)
    )
  } catch {
    return false
  }
}
const headers = { 'Cache-Control': 'private, no-store, max-age=0' }
export function workflowErrorResponse(
  error: unknown,
  requestId: string = randomUUID(),
) {
  if (error instanceof WorkflowError)
    return Response.json(
      {
        ok: false,
        requestId,
        error: {
          code: error.code,
          message:
            'The Email action could not be completed. Review the current state before trying again.',
          retryable: error.status >= 500,
        },
      },
      { status: error.status, headers },
    )
  // No database URLs, credentials, SQL or private message text in the response.
  return Response.json(
    {
      ok: false,
      requestId,
      error: {
        code: 'EMAIL_UNAVAILABLE',
        message: 'Email is temporarily unavailable.',
        retryable: true,
      },
    },
    { status: 503, headers },
  )
}
export function createWorkflowHttp(dependencies: WorkflowHttpDependencies) {
  return {
    async GET(request: Request) {
      try {
        const subject = await dependencies.subject(request)
        if (!subject) throw new WorkflowError('SIGN_IN_REQUIRED', 401)
        const campaignId = new URL(request.url).searchParams.get('review')
        if (campaignId && !z.string().uuid().safeParse(campaignId).success)
          throw new WorkflowError('INVALID_CAMPAIGN', 400)
        const sql = dependencies.database(),
          now = dependencies.now?.() ?? new Date()
        const data = campaignId
          ? await getPilotReview(sql, subject, campaignId, now)
          : await readPilotState(sql, subject, now)
        return Response.json(data, { headers })
      } catch (error) {
        return workflowErrorResponse(error)
      }
    },
    async POST(request: Request) {
      let requestId: string = randomUUID()
      try {
        if (!sameOrigin(request)) throw new WorkflowError('INVALID_ORIGIN', 403)
        if (
          !request.headers.get('content-type')?.startsWith('application/json')
        )
          throw new WorkflowError('JSON_REQUIRED', 415)
        const subject = await dependencies.subject(request)
        if (!subject) throw new WorkflowError('SIGN_IN_REQUIRED', 401)
        const text = await request.text()
        if (text.length > 64000)
          throw new WorkflowError('COMMAND_TOO_LARGE', 413)
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          throw new WorkflowError('INVALID_JSON', 400)
        }
        const key = z
          .object({ idempotencyKey: z.string().uuid() })
          .safeParse(body)
        if (key.success) requestId = key.data.idempotencyKey
        const result = await executePilotCommand(
          dependencies.database(),
          subject,
          body,
          dependencies.now?.() ?? new Date(),
        )
        return Response.json(
          emailCommandSuccessSchema.parse({
            ok: true,
            requestId,
            entityId: result.entityId,
            revision: result.revision ?? 0,
            state: result.state,
            invalidates: result.invalidates ?? ['email:workspace'],
          }),
          { headers },
        )
      } catch (error) {
        return workflowErrorResponse(error, requestId)
      }
    },
  }
}
