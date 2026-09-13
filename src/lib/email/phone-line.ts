export const RESERVED_ADS_NUMBER_ID = '00000000-0000-4000-8000-0000000000ad'

export function canSaveResponseLine(input: {
  existingProviderNumberId: string
  purpose: string
  purchase: boolean
}) {
  return (
    input.purpose === 'email_response' &&
    !input.purchase &&
    input.existingProviderNumberId !== RESERVED_ADS_NUMBER_ID
  )
}

export function responseLineStateAfterSave() {
  return 'intended' as const
}

export function blastAndDialerEligibility() {
  return { blast: false, dialer: false }
}

export function canTestResponseLine(state: string) {
  return state === 'verified'
}
