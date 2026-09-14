import { createWorkflowHttp } from '../../../../../../src/lib/email/workflow/http'
import { database, now, subject } from '../../../../runtime'
export const dynamic = 'force-dynamic'
const handlers = createWorkflowHttp({ database, now, subject })
export const GET = handlers.GET
export const POST = handlers.POST
