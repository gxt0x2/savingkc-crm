export type DialerSurface = 'crm' | 'prospecting' | 'automation'
export type InteractiveDialerSurface = Exclude<DialerSurface, 'automation'>

export function dialerCallIntentEndpoint(surface: InteractiveDialerSurface): string {
  return surface === 'prospecting'
    ? '/api/prospecting/call-intents'
    : '/api/crm/call-intents'
}
