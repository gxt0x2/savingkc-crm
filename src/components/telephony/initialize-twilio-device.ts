import { verifyMicrophoneInput } from '@/lib/telephony/microphone-preflight'
import type { CallStatus, TwilioDevice, TwilioErrorLike } from './telephony-bar-types'
import { extractTwilioErrorMessage, isNonFatalAudioWarning } from './telephony-bar-support'

type InitializeTwilioDeviceOptions = {
  log: (message: string) => void
  onCallerId: (callerId: string) => void
  onError: (message: string) => void
  onIdentity: (identity: string) => void
  onIncoming: (call: TwilioDevice) => void
  onStatus: (status: CallStatus) => void
}

export async function initializeTwilioDevice(options: InitializeTwilioDeviceOptions): Promise<TwilioDevice> {
  options.log('checking microphone...')
  await verifyMicrophoneInput()
  options.log('microphone ready')
  options.log('fetching token...')

  const { Device } = await import('@twilio/voice-sdk')
  const response = await fetch('/api/twilio-token')
  const data = await response.json()
  if (!response.ok || data.error) {
    throw new Error('Phone service is unavailable. Retry in a moment or use the production CRM.')
  }
  if (data.callerId) options.onCallerId(data.callerId)
  if (data.identity) options.onIdentity(data.identity)
  options.log('token received')

  // SDK debug logging includes signaling payloads. Keep browser logs at
  // warning level while retaining the app's redacted dialer lifecycle logs.
  const device = new Device(data.token, { logLevel: 'warn' })
  device.on('registered', () => options.onStatus('ready'))
  device.on('unregistered', () => options.onStatus('offline'))
  device.on('tokenWillExpire', async () => {
    options.log('token expiring, refreshing...')
    try {
      const refreshResponse = await fetch('/api/twilio-token')
      const refreshData = await refreshResponse.json()
      if (!refreshResponse.ok || !refreshData.token) throw new Error('Token refresh failed')
      device.updateToken(refreshData.token)
      if (refreshData.callerId) options.onCallerId(refreshData.callerId)
      if (refreshData.identity) options.onIdentity(refreshData.identity)
      options.log('token refreshed')
    } catch {
      options.log('token refresh failed')
    }
  })
  device.on('error', (error: TwilioErrorLike) => {
    const message = extractTwilioErrorMessage(error)
    if (isNonFatalAudioWarning(error)) {
      options.log(`non-fatal audio warning: ${message}`)
      return
    }
    options.log(`device error: ${message}`)
    options.onError(message)
    options.onStatus('offline')
  })
  device.on('incoming', options.onIncoming)

  options.log('registering device...')
  try {
    await device.register()
    return device
  } catch (error) {
    device.destroy()
    throw error
  }
}
