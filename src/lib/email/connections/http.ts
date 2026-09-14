import 'server-only'
import type { WorkflowHttpDependencies } from '../workflow/http'
import { sameOrigin, workflowErrorResponse } from '../workflow/http'
import { WorkflowError } from '../workflow/core'
import { connectService, disconnectService, readConnections } from './service'

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
      return mutate(request, false)
    },
    async DELETE(request: Request) {
      return mutate(request, true)
    },
  }
  async function mutate(request: Request, disconnect: boolean) {
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
      return Response.json(
        await (disconnect
          ? disconnectService(dependencies.database(), subject, input)
          : connectService(dependencies.database(), subject, input)),
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    } catch (error) {
      return workflowErrorResponse(error)
    }
  }
}
