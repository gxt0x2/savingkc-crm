/** Plain-text footer shared by hosted campaign and reply envelopes. */
export function outreachFooter(businessName: string, address: string, unsubscribeUrl: string) {
  const postalAddress = address.trim().replace(/,\s*(Kansas City,?\s*MO\s*64108)/i, '\n$1')
  return `The very best regards\nAri\n${businessName}\n${postalAddress}\n\nIf you’d rather I not email you again, just reply “remove” and I’ll take you off the list today.\nUnsubscribe: ${unsubscribeUrl}`
}
