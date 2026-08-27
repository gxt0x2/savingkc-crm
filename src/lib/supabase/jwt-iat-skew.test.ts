import { describe, expect, it, vi } from 'vitest'
import { isJwtIssuedAtFuture, rpcWithIatSkewRetry } from './jwt-iat-skew'

describe('jwt iat skew retry', () => {
  it('matches the PostgREST future-iat rejection exactly', () => {
    expect(isJwtIssuedAtFuture('JWT issued at future')).toBe(true)
    expect(isJwtIssuedAtFuture('Mojo queue claim failed: JWT issued at future')).toBe(true)
    expect(isJwtIssuedAtFuture('connection reset')).toBe(false)
    expect(isJwtIssuedAtFuture(null)).toBe(false)
  })

  it('retries once on JWT issued at future and returns the second result', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'JWT issued at future' } })
      .mockResolvedValueOnce({ data: [], error: null })
    await expect(rpcWithIatSkewRetry(run)).resolves.toEqual({ data: [], error: null })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not retry unrelated errors', async () => {
    const error = { message: 'connection reset' }
    const run = vi.fn().mockResolvedValue({ data: null, error })
    await expect(rpcWithIatSkewRetry(run)).resolves.toEqual({ data: null, error })
    expect(run).toHaveBeenCalledOnce()
  })
})
