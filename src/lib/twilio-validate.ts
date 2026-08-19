/**
 * Twilio Request Signature Validation
 * Ensures webhook requests actually come from Twilio
 */

import twilio from 'twilio'

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

function canSkipSignatureValidation(): boolean {
  const requested = process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === 'true'
  if (!requested) return false

  if (isProductionRuntime()) {
    console.error('Ignoring TWILIO_SKIP_SIGNATURE_VALIDATION in a production runtime')
    return false
  }

  return true
}

/**
 * Validate that a request came from Twilio using its signature
 * Returns true if valid, false if forged
 */
export function validateTwilioRequest(
  url: string,
  params: Record<string, string>,
  signature: string | null
): boolean {
  if (canSkipSignatureValidation()) {
    console.warn('TWILIO_SKIP_SIGNATURE_VALIDATION is enabled - accepting Twilio webhook without signature validation')
    return true
  }
  if (!signature) return false
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('TWILIO_AUTH_TOKEN not set - rejecting Twilio webhook')
    return false
  }
  return twilio.validateRequest(authToken, signature, url, params)
}

/**
 * Extract Twilio signature and build params from a Request object
 */
export async function validateTwilioWebhook(req: Request): Promise<boolean> {
  // Local development may bypass validation, but deployed production never can.
  if (process.env.NODE_ENV === 'development' && !isProductionRuntime()) return true

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
