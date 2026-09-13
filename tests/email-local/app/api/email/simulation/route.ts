import { z } from 'zod'
import {
  simulateDelivery,
  simulateInbound,
  WorkflowError,
} from '../../../../../../src/lib/email/workflow/service'
import {
  sameOrigin,
  workflowErrorResponse,
} from '../../../../../../src/lib/email/workflow/http'
import { database, now, subject } from '../../../../runtime'
const schema = z
  .object({
    kind: z.enum(['deliver', 'inbound']),
    requestId: z.string().uuid(),
    threadId: z.string().uuid().nullable(),
    body: z.string().max(10000),
  })
  .strict()
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new WorkflowError('INVALID_ORIGIN', 403)
    const actor = await subject(request)
    if (!actor) throw new WorkflowError('LOCAL_HARNESS_DISABLED', 404)
    const input = schema.parse(await request.json())
    const result =
      input.kind === 'deliver'
        ? await simulateDelivery(database(), actor, input.requestId, now())
        : input.threadId
          ? await simulateInbound(
              database(),
              actor,
              {
                threadId: input.threadId,
                eventId: input.requestId,
                body: input.body,
              },
              now(),
            )
          : null
    if (!result) throw new WorkflowError('THREAD_REQUIRED', 400)
    return Response.json(result)
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
