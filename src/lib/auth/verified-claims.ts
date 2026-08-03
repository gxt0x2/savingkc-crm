type VerifiedClaimsResult = {
  data: { claims?: { sub?: unknown } } | null
  error: unknown
}

export function hasVerifiedSubject(result: VerifiedClaimsResult): boolean {
  return !result.error && typeof result.data?.claims?.sub === 'string' && result.data.claims.sub.length > 0
}
