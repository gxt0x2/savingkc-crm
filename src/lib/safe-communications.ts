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
import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { isAllowedSmsSender, normalizeTwilioNumber, type SmsSenderUse } from '@/lib/twilio-numbers'

const TEST_MODE = externalSideEffectsDisabled()

function cleanTwilioEnv(name: string): string {
  return process.env[name]
    ?.replace(/\\[rnt]/g, '')
    .replace(/\s+/g, '')
    .trim() ?? ''
}

let twilioClient: ReturnType<typeof twilio> | null = null
let twilioInitError: string | null = null

function initTwilioClient(): ReturnType<typeof twilio> | null {
  if (TEST_MODE) return null

  const accountSid = cleanTwilioEnv('TWILIO_ACCOUNT_SID')
  const apiKey = cleanTwilioEnv('TWILIO_API_KEY')
  const apiSecret = cleanTwilioEnv('TWILIO_API_SECRET')
  const authToken = cleanTwilioEnv('TWILIO_AUTH_TOKEN')

  if (!accountSid) {
    twilioInitError = 'Twilio SMS is not configured: missing TWILIO_ACCOUNT_SID'
    return null
  }

  if (accountSid && apiKey && apiSecret) {
    twilioInitError = null
    return twilio(apiKey, apiSecret, { accountSid })
  }

  if (accountSid && authToken) {
    twilioInitError = null
    return twilio(accountSid, authToken)
  }

  twilioInitError = 'Twilio SMS is not configured: missing TWILIO_API_KEY/TWILIO_API_SECRET or TWILIO_AUTH_TOKEN'
  return null
}

function getConfiguredTwilioClient(): ReturnType<typeof twilio> | null {
  if (!twilioClient) {
    twilioClient = initTwilioClient()
  }
  return twilioClient
}

function getTwilioErrorField(error: unknown, field: 'message' | 'code' | 'status'): unknown {
  return typeof error === 'object' && error !== null && field in error
    ? (error as Record<typeof field, unknown>)[field]
    : undefined
}

// Supabase client for logging

interface SMSParams {
  to: string
  from: string
  body: string
  senderUse?: SmsSenderUse
}

export interface SMSResult {
  success: boolean
  sid?: string
  status?: string
  error?: string
  to: string
  from: string
  body: string
  requestedFrom?: string
  senderMismatch?: boolean
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
  const requestedFrom = normalizeTwilioNumber(params.from)
  const senderUse = params.senderUse || 'system'

  if (!requestedFrom || !isAllowedSmsSender(requestedFrom, senderUse)) {
    const error = `SMS sender is not approved for ${senderUse}: ${params.from || 'missing'}`
    console.error('[SMS-SENDER-POLICY]', { requestedFrom: params.from || null, senderUse })
    await logSMSAttempt({ ...params, from: requestedFrom || params.from, success: false, error })
    return { success: false, error, ...params, from: requestedFrom || params.from }
  }

  const sendParams = { ...params, from: requestedFrom }

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
      to: sendParams.to,
      from: sendParams.from,
      body: sendParams.body,
    }
  }

  const client = getConfiguredTwilioClient()
  if (!client) {
    const error = twilioInitError || 'Twilio client not initialized'
    console.error(`[SMS-ERROR] ${error}`)
    await logSMSAttempt({ ...sendParams, success: false, error })
    return { success: false, error, ...sendParams }
  }

  try {
    const messagingServiceSid = cleanTwilioEnv('TWILIO_MESSAGING_SERVICE')
    const message = await client.messages.create({
      to: sendParams.to,
      from: sendParams.from,
      body: sendParams.body,
      ...(messagingServiceSid ? { messagingServiceSid } : {}),
    })
    const duration = Date.now() - startTime
    const actualFrom = normalizeTwilioNumber(message.from) || sendParams.from
    const senderMismatch = actualFrom !== sendParams.from

    console.log(`[SMS-SUCCESS] Sent to ${sendParams.to} (SID: ${message.sid}, ${duration}ms)`)
    if (senderMismatch) {
      console.error('[SMS-SENDER-MISMATCH]', {
        sid: message.sid,
        requestedFrom: sendParams.from,
        actualFrom,
        senderUse,
      })
    }

    await logSMSAttempt({
      ...sendParams,
      from: actualFrom,
      success: true,
      sid: message.sid,
      status: message.status,
    })

    return {
      success: true,
      sid: message.sid,
      status: message.status,
      to: sendParams.to,
      from: actualFrom,
      requestedFrom: sendParams.from,
      senderMismatch,
      body: sendParams.body,
    }
  } catch (error: unknown) {
    const duration = Date.now() - startTime
    const message = getTwilioErrorField(error, 'message')
    const code = getTwilioErrorField(error, 'code')
    const status = getTwilioErrorField(error, 'status')
    const errorMsg = typeof message === 'string' && message ? message : 'Unknown error'
    const twilioCode = typeof code === 'number' ? code : undefined
    const twilioStatus = typeof status === 'number' ? status : undefined

    console.error(`[SMS-ERROR] Failed to send to ${sendParams.to} (${duration}ms)`)
    console.error(`  Error: ${errorMsg}`)
    if (twilioCode) console.error(`  Twilio Code: ${twilioCode}`)
    if (twilioStatus) console.error(`  HTTP Status: ${twilioStatus}`)

    await logSMSAttempt({
      ...sendParams,
      success: false,
      error: errorMsg,
      twilioCode,
      twilioStatus,
    })

    return {
      success: false,
      error: errorMsg,
      to: sendParams.to,
      from: sendParams.from,
      body: sendParams.body,
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
  return getConfiguredTwilioClient()
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
