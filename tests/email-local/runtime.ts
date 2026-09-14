import postgres from 'postgres'
import { WorkflowError } from '../../src/lib/email/workflow/service'
export const owner = '00000000-0000-4000-8000-000000000001'
export const now = () => new Date('2026-09-14T15:00:00.000Z')
let sql: ReturnType<typeof postgres> | undefined
export function database() {
  const url = process.env.EMAIL_LOCAL_DATABASE_URL
  if (process.env.NODE_ENV !== 'development' || !url)
    throw new WorkflowError('LOCAL_HARNESS_DISABLED', 404)
  const parsed = new URL(url)
  if (
    parsed.hostname !== '127.0.0.1' ||
    parsed.pathname !== '/email_test_workflow'
  )
    throw new WorkflowError('LOCAL_DATABASE_REQUIRED', 503)
  sql ??= postgres(url, { max: 4, prepare: false })
  return sql
}
export async function subject(request: Request) {
  database()
  if (!['localhost', '127.0.0.1'].includes(new URL(request.url).hostname))
    return null
  return owner
}
