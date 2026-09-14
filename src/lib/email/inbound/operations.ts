import 'server-only'
import type { Sql } from 'postgres'
import { z } from 'zod'
import { RETRIEVAL_RETRY_CODES } from './retry'
import { ownerWorkspace } from '../connections/service'
import { check, WorkflowError, type Tx } from '../workflow/core'
import { sameOrigin, workflowErrorResponse } from '../workflow/http'
import { processNextReceivedReply } from './worker'

export async function readReceivingWork(sql: Sql, subject: string) {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const jobs =
      await tx`select j.id,j.kind,j.state,j.attempts,j.run_after,j.lease_until,j.last_error,e.thread_id,e.hold_reason,e.type from em_jobs j join em_provider_events e on e.id=j.entity_id and e.workspace_id=j.workspace_id where j.workspace_id=${ws.id} and j.kind in ('resend_receive_content','resend_event_review') and j.state<>'done' order by j.created_at,j.id limit 50`
    const [totals] =
      await tx`select count(*)::int as total from em_jobs where workspace_id=${ws.id} and kind in ('resend_receive_content','resend_event_review') and state<>'done'`
    return {
      jobs: jobs.map((j) => ({
        ...j,
        can_retry:
          j.state === 'dead' &&
          j.kind === 'resend_receive_content' &&
          RETRIEVAL_RETRY_CODES.includes(j.last_error),
      })),
      total: totals.total,
    }
  })
}
export function createReceivingHttp(deps: {
  database: () => Sql
  subject: (request: Request) => Promise<string | null>
  process?: typeof processNextReceivedReply
}) {
  return {
    async GET(request: Request) {
      try {
        const subject = await deps.subject(request)
        check(subject, 'SIGN_IN_REQUIRED', 401)
        return Response.json(
          await readReceivingWork(deps.database(), subject),
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      } catch (error) {
        return workflowErrorResponse(error)
      }
    },
    async POST(request: Request) {
      try {
        check(sameOrigin(request), 'INVALID_ORIGIN', 403)
        check(
          request.headers.get('content-type')?.startsWith('application/json'),
          'JSON_REQUIRED',
          415,
        )
        const subject = await deps.subject(request)
        check(subject, 'SIGN_IN_REQUIRED', 401)
        const text = await request.text()
        check(text.length < 1024, 'COMMAND_TOO_LARGE', 413)
        const parsed = z
          .object({ action: z.literal('process_next') })
          .strict()
          .safeParse(parseJson(text))
        check(parsed.success, 'INVALID_COMMAND', 400)
        return Response.json(
          await (deps.process ?? processNextReceivedReply)(
            deps.database(),
            subject,
          ),
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      } catch (error) {
        return workflowErrorResponse(error)
      }
    },
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new WorkflowError('INVALID_JSON', 400)
  }
}
