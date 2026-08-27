export function isJwtIssuedAtFuture(message: string | null | undefined): boolean {
  return /jwt issued at future/i.test(message || '')
}

export async function rpcWithIatSkewRetry<Data>(
  run: () => PromiseLike<{ data: Data; error: { message: string } | null }>,
): Promise<{ data: Data; error: { message: string } | null }> {
  const first = await run()
  if (first.error && isJwtIssuedAtFuture(first.error.message)) return run()
  return first
}
