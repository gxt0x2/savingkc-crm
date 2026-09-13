import 'server-only'
import { createHash } from 'node:crypto'
import type {
  TransactionSql,
  PendingQuery,
  ParameterOrFragment,
  Row,
} from 'postgres'

// postgres 3.4.8 uses Omit for TransactionSql, which drops its runtime call
// signatures. Restore the query signatures at this one adapter boundary.
export type Tx = Pick<
  TransactionSql,
  'json' | 'array' | 'unsafe' | 'savepoint'
> & {
  <T extends readonly object[] = Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly ParameterOrFragment<never>[]
  ): PendingQuery<T>
}
export type Member = {
  workspace_id: string
  auth_user_id: string
  roles: string[]
}
export type Context = { tx: Tx; member: Member; now: Date }
export type Result = {
  entityId: string
  state: string
  revision?: number
  bodyHash?: string
  invalidates?: string[]
}
export class WorkflowError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code)
  }
}
export function check(
  condition: unknown,
  code: string,
  status = 409,
): asserts condition {
  if (!condition) throw new WorkflowError(code, status)
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function workflowHash(value: unknown) {
  return createHash('sha256').update(stable(value)).digest('hex')
}
export function json(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}
