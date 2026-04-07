/**
 * Safe wrappers for SMS and Email sending with TEST_MODE protection
 *
 * CRITICAL: These functions prevent accidental SMS/email to real prospects
 * during development and testing.
 *
 * Set TEST_MODE=true in .env.local to enable test mode.
 */

import twilio from 'twilio'

const TEST_MODE = process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'development'

// Twilio client (only initialized if not in test mode)
let twilioClient: ReturnType<typeof twilio> | null = null

if (!TEST_MODE) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  )
}

interface SMSParams {
  to: string
  from: string
  body: string
}

/**
 * Safe SMS sending with TEST_MODE protection
 *
 * In TEST_MODE:
 * - Logs the SMS details to console
 * - Does NOT send actual SMS
 * - Returns a mock success response
 *
 * In PRODUCTION:
 * - Sends real SMS via Twilio
 */
export async function safeSendSMS(params: SMSParams) {
  if (TEST_MODE) {
    console.log('\n🧪 [TEST_MODE] SMS NOT SENT:')
    console.log('  To:', params.to)
    console.log('  From:', params.from)
    console.log('  Body:', params.body)
    console.log('')

    // Return mock response matching Twilio's structure
    return {
      sid: 'TEST_MESSAGE_SID_' + Date.now(),
      status: 'queued',
      to: params.to,
      from: params.from,
      body: params.body,
    }
  }

  if (!twilioClient) {
    throw new Error('Twilio client not initialized')
  }

  return await twilioClient.messages.create(params)
}

/**
 * Get Twilio client (for voice calls, etc.)
 * Returns null in TEST_MODE to prevent accidental usage
 */
export function getTwilioClient() {
  if (TEST_MODE) {
    console.warn('⚠️  [TEST_MODE] Twilio client requested but TEST_MODE is active')
    return null
  }
  return twilioClient
}

/**
 * Safe email sending with TEST_MODE protection
 * (Placeholder for future email implementation)
 */
export async function safeSendEmail(params: {
  to: string
  subject: string
  body: string
}) {
  if (TEST_MODE) {
    console.log('\n🧪 [TEST_MODE] EMAIL NOT SENT:')
    console.log('  To:', params.to)
    console.log('  Subject:', params.subject)
    console.log('  Body:', params.body.substring(0, 100) + '...')
    console.log('')
    return { success: true, messageId: 'TEST_EMAIL_' + Date.now() }
  }

  // TODO: Implement real email sending (SendGrid, Resend, etc.)
  throw new Error('Email sending not yet implemented')
}

/**
 * Check if currently in test mode
 */
export function isTestMode(): boolean {
  return TEST_MODE
}

/**
 * Log test mode status on import
 */
if (TEST_MODE) {
  console.log('🧪 TEST_MODE is ACTIVE - SMS and Email sending is DISABLED')
}
