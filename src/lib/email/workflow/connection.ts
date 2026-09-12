import 'server-only'
import postgres from 'postgres'
import { WorkflowError } from './service'

let connection: ReturnType<typeof postgres> | undefined
export function pilotDatabase() {
  // No fallback to another module's CRM/service credentials. Enabling this
  // connection is an explicit later configuration step.
  if (
    process.env.EMAIL_WORKFLOW_MODE !== 'simulation' ||
    !process.env.EMAIL_DATABASE_URL
  ) {
    throw new WorkflowError('EMAIL_SETUP_REQUIRED', 503)
  }
  connection ??= postgres(process.env.EMAIL_DATABASE_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 5,
  })
  return connection
}
