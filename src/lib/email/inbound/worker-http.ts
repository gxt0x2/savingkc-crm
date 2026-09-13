import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Sql } from 'postgres'
import { processNextReceivedReply } from './worker'
import { workflowErrorResponse } from '../workflow/http'
import { WorkflowError } from '../workflow/core'
export function createReceivingWorkerHttp(deps: {
  database: () => Sql
  enabled: () => boolean
  secret: () => string | undefined
  ownerId: () => string | undefined
  process?: typeof processNextReceivedReply
}) {
  return async function run(request: Request) {
    try {
      const secret = deps.secret(),
        supplied = request.headers
          .get('authorization')
          ?.match(/^Bearer (\S+)$/)?.[1]
      if (
        !secret ||
        secret.length < 32 ||
        !supplied ||
        supplied.length > 1024 ||
        !timingSafeEqual(
          createHash('sha256').update(secret).digest(),
          createHash('sha256').update(supplied).digest(),
        )
      )
        throw new WorkflowError('UNAUTHORIZED', 401)
      if (!deps.enabled())
        return Response.json(
          { state: 'disabled', processed: 0 },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      const ownerId = deps.ownerId()
      if (!z.string().uuid().safeParse(ownerId).success)
        throw new WorkflowError('WORKER_CONFIGURATION_REQUIRED', 503)
      const result = await (deps.process ?? processNextReceivedReply)(
        deps.database(),
        ownerId!,
      )
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      return workflowErrorResponse(error)
    }
  }
}
