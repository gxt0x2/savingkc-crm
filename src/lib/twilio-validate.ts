/**
 * Twilio Request Signature Validation
 * Ensures webhook requests actually come from Twilio
 */

import twilio from 'twilio'

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const SKIP_SIGNATURE_VALIDATION = process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === 'true'

/**
 * Validate that a request came from Twilio using its signature
 * Returns true if valid, false if forged
 */
export function validateTwilioRequest(
  url: string,
  params: Record<string, string>,
  signature: string | null
): boolean {
  if (SKIP_SIGNATURE_VALIDATION) {
    console.warn('TWILIO_SKIP_SIGNATURE_VALIDATION is enabled - accepting Twilio webhook without signature validation')
    return true
  }
  if (!signature) return false
  if (!AUTH_TOKEN) {
    console.error('TWILIO_AUTH_TOKEN not set - rejecting Twilio webhook')
    return false
  }
  return twilio.validateRequest(AUTH_TOKEN, signature, url, params)
}

/**
 * Extract Twilio signature and build params from a Request object
 */
export async function validateTwilioWebhook(req: Request): Promise<boolean> {
  // In development, skip validation
  if (process.env.NODE_ENV === 'development') return true

  const signature = req.headers.get('x-twilio-signature')
  if (!signature) return false

  // Clone the request to read body without consuming it
  const cloned = req.clone()
  const formData = await cloned.formData()
  const params: Record<string, string> = {}
  formData.forEach((value, key) => {
    params[key] = value.toString()
  })

  // Build the full URL Twilio used to sign
  const url = new URL(req.url)
  const fullUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'}${url.pathname}${url.search}`

  return validateTwilioRequest(fullUrl, params, signature)
}
