import type { EmailStatus } from './status'

export type PaidEmailStatus = Exclude<EmailStatus, 'unverified'>

export type ProviderVerification = {
  status: PaidEmailStatus
  role: boolean
  raw: Record<string, unknown>
}

export interface EmailValidationProvider {
  readonly id: 'millionverifier'
  verify(email: string): Promise<ProviderVerification>
}

export class ProviderCheckError extends Error {
  readonly raw: Record<string, unknown>

  constructor(message: string, raw: Record<string, unknown> = { error: 'provider_unavailable' }) {
    super(message)
    this.name = 'ProviderCheckError'
    this.raw = raw
  }
}
