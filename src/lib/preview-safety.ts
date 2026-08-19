/**
 * Preview deployments must never contact sellers or export marketing events.
 * TEST_MODE also supports safe local/CI use outside Vercel.
 */
export function externalSideEffectsDisabled(): boolean {
  return (
    process.env.TEST_MODE === 'true' ||
    process.env.NODE_ENV === 'development' ||
    process.env.VERCEL_ENV === 'preview'
  )
}

export function previewWriteBlocked(method: string, pathname: string): boolean {
  if (process.env.VERCEL_ENV !== 'preview') return false
  if (process.env.PREVIEW_ALLOW_WRITES === 'true') return false
  if (!pathname.startsWith('/api/')) return false
  if (method.toUpperCase() === 'POST' && pathname === '/api/assistant/read') return false

  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}
