const DEFAULT_INTERNAL_TEST_PHONE_DIGITS = [
  '19137179617',
  '9137179617',
]

function phoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function configuredTestPhoneDigits(): string[] {
  const configured = [
    process.env.INTERNAL_TEST_PHONES,
    process.env.PPC_INTERNAL_TEST_PHONES,
    process.env.GOOGLE_ADS_TEST_PHONES,
  ]

  return configured
    .flatMap((value) => (value ?? '').split(','))
    .map(phoneDigits)
    .filter(Boolean)
}

export function isInternalTestPhone(value: string | null | undefined): boolean {
  const digits = phoneDigits(value)
  if (!digits) return false

  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return [...DEFAULT_INTERNAL_TEST_PHONE_DIGITS, ...configuredTestPhoneDigits()].some((candidate) => {
    const candidateNational = candidate.length === 11 && candidate.startsWith('1') ? candidate.slice(1) : candidate
    return digits === candidate || national === candidateNational
  })
}
