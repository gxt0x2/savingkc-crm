/**
 * Safe wrappers for SMS and Email sending with TEST_MODE protection
 *
 * CRITICAL: These functions prevent accidental SMS/email to real prospects
 * during development and testing.
 *
 * Set TEST_MODE=true in .env.local to enable test mode.
 */

import twilio from 'twilio'
import { supabase } from '@/lib/supabase-lazy'

const TEST_MODE = process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'development'
const TWILIO_MESSAGING_SERVICE = cleanTwilioEnv('TWILIO_MESSAGING_SERVICE')

function cleanTwilioEnv(name: string): string {
  return process.env[name]
    ?.replace(/\\[rnt]/g, '')
    .replace(/\s+/g, '')
    .trim() ?? ''
}

// Twilio client (only initialized if not in test mode)
let twilioClient: ReturnType<typeof twilio> | null = null

if (!TEST_MODE) {
  const accountSid = cleanTwilioEnv('TWILIO_ACCOUNT_SID')
  const apiKey = cleanTwilioEnv('TWILIO_API_KEY')
  const apiSecret = cleanTwilioEnv('TWILIO_API_SECRET')
  const authToken = cleanTwilioEnv('TWILIO_AUTH_TOKEN')

  if (accountSid && apiKey && apiSecret) {
    twilioClient = twilio(apiKey, apiSecret, { accountSid })
  } else if (accountSid && authToken) {
    twilioClient = twilio(accountSid, authToken)
  }
}

// Supabase client for logging

interface SMSParams {
  to: string
  from: string
  body: string
}

export interface SMSResult {
  success: boolean
  sid?: string
  status?: string
  error?: string
  to: string
  from: string
  body: string
}

/**
 * Safe SMS sending with comprehensive error logging and tracking
 *
 * In TEST_MODE:
 * - Logs the SMS details to console
 * - Does NOT send actual SMS
 * - Returns a mock success response
 *
 * In PRODUCTION:
 * - Sends real SMS via Twilio
 * - Logs all attempts (success and failure) to sms_delivery_log table
 * - Returns detailed success/error information
 * - NEVER throws errors - always returns result object
 */
export async function safeSendSMS(params: SMSParams): Promise<SMSResult> {
  const startTime = Date.now()

  if (TEST_MODE) {
    console.log('\n🧪 [TEST_MODE] SMS NOT SENT:')
    console.log('  To:', params.to)
    console.log('  From:', params.from)
    console.log('  Body:', params.body)
    console.log('')

    // Return mock response
    return {
      success: true,
      sid: 'TEST_MESSAGE_SID_' + Date.now(),
      status: 'queued',
      to: params.to,
      from: params.from,
      body: params.body,
    }
  }

  if (!twilioClient) {
    const error = 'Twilio client not initialized'
    console.error(`[SMS-ERROR] ${error}`)
    await logSMSAttempt({ ...params, success: false, error })
    return { success: false, error, ...params }
  }

  try {
    const message = await twilioClient.messages.create({
      ...params,
      ...(TWILIO_MESSAGING_SERVICE ? { messagingServiceSid: TWILIO_MESSAGING_SERVICE } : {}),
    })
    const duration = Date.now() - startTime

    console.log(`[SMS-SUCCESS] Sent to ${params.to} (SID: ${message.sid}, ${duration}ms)`)

    await logSMSAttempt({
      ...params,
      success: true,
      sid: message.sid,
      status: message.status,
    })

    return {
      success: true,
      sid: message.sid,
      status: message.status,
      to: params.to,
      from: params.from,
      body: params.body,
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    const errorMsg = error?.message || 'Unknown error'
    const twilioCode = error?.code
    const twilioStatus = error?.status

    console.error(`[SMS-ERROR] Failed to send to ${params.to} (${duration}ms)`)
    console.error(`  Error: ${errorMsg}`)
    if (twilioCode) console.error(`  Twilio Code: ${twilioCode}`)
    if (twilioStatus) console.error(`  HTTP Status: ${twilioStatus}`)

    await logSMSAttempt({
      ...params,
      success: false,
      error: errorMsg,
      twilioCode,
      twilioStatus,
    })

    return {
      success: false,
      error: errorMsg,
      to: params.to,
      from: params.from,
      body: params.body,
    }
  }
}

/**
 * Log SMS attempt to database for monitoring and debugging
 */
async function logSMSAttempt(data: {
  to: string
  from: string
  body: string
  success: boolean
  sid?: string
  status?: string
  error?: string
  twilioCode?: number
  twilioStatus?: number
}) {
  try {
    await supabase.from('sms_delivery_log').insert({
      to_phone: data.to,
      from_phone: data.from,
      message_body: data.body.slice(0, 1000), // Truncate long messages
      success: data.success,
      twilio_sid: data.sid,
      twilio_status: data.status,
      error_message: data.error,
      twilio_error_code: data.twilioCode,
      http_status: data.twilioStatus,
    })
  } catch (err) {
    // Don't let logging failures break SMS sending
    console.error('[SMS-LOG-ERROR] Failed to log SMS attempt:', err)
  }
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
