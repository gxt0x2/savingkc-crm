const TEST_PATTERNS = [
  /(^|[^a-z0-9])test([^a-z0-9]|$)/i,
  /do not contact/i,
  /not a real/i,
  /dummy/i,
  /demo/i,
  /sample/i,
]

export function isNonRealRecord(...values: unknown[]) {
  return values
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .some((value) => TEST_PATTERNS.some((pattern) => pattern.test(String(value))))
}
