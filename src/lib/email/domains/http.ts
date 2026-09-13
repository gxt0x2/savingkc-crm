import 'server-only'
import type { WorkflowHttpDependencies } from '../workflow/http'
import { sameOrigin, workflowErrorResponse } from '../workflow/http'
import { WorkflowError } from '../workflow/core'
import { executeDomainCommand, readDomains } from './service'
export function createDomainHttp(dependencies: WorkflowHttpDependencies) {
  return {
    async GET(request: Request) {
      try {
        const subject = await dependencies.subject(request)
        if (!subject) throw new WorkflowError('SIGN_IN_REQUIRED', 401)
        return Response.json(
          await readDomains(dependencies.database(), subject),
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      } catch (error) {
        return workflowErrorResponse(error)
      }
    },
    async POST(request: Request) {
      try {
        if (!sameOrigin(request)) throw new WorkflowError('INVALID_ORIGIN', 403)
        if (
          !request.headers.get('content-type')?.startsWith('application/json')
        )
          throw new WorkflowError('JSON_REQUIRED', 415)
        const subject = await dependencies.subject(request)
        if (!subject) throw new WorkflowError('SIGN_IN_REQUIRED', 401)
        const text = await request.text()
        if (text.length > 16000)
          throw new WorkflowError('COMMAND_TOO_LARGE', 413)
        let input: unknown
        try {
          input = JSON.parse(text)
        } catch {
          throw new WorkflowError('INVALID_JSON', 400)
        }
        return Response.json(
          await executeDomainCommand(dependencies.database(), subject, input),
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      } catch (error) {
        return workflowErrorResponse(error)
      }
    },
  }
}
