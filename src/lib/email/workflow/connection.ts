import 'server-only'
import postgres from 'postgres'
import { WorkflowError } from './service'

// No fallback to another module's CRM/service credentials. Enabling this
// connection is an explicit later configuration step. EMAIL_DATABASE_URL is
// the only accepted Postgres URL for both helpers.
let simulationConnection: ReturnType<typeof postgres> | undefined
let hostedConnection: ReturnType<typeof postgres> | undefined

function emailPostgres(url: string) {
  return postgres(url, {
    max: 3,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 5,
  })
}

export function pilotDatabase() {
  if (
    process.env.EMAIL_WORKFLOW_MODE !== 'simulation' ||
    !process.env.EMAIL_DATABASE_URL
  ) {
    throw new WorkflowError('EMAIL_SETUP_REQUIRED', 503)
  }
  simulationConnection ??= emailPostgres(process.env.EMAIL_DATABASE_URL)
  return simulationConnection
}

export function emailDatabase() {
  if (
    process.env.EMAIL_WORKFLOW_MODE !== 'hosted' ||
    !process.env.EMAIL_DATABASE_URL
  ) {
    throw new WorkflowError('EMAIL_HOSTED_SETUP_REQUIRED', 503)
  }
  hostedConnection ??= emailPostgres(process.env.EMAIL_DATABASE_URL)
  return hostedConnection
}
