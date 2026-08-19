import type { Call, CallInvite, Voice } from '@twilio/voice-react-native-sdk'

import { fetchVoiceToken, requestMobileCallIntent } from './api'

export type VoiceState = 'registering' | 'ready' | 'ringing' | 'connecting' | 'connected' | 'offline' | 'error'

export type IncomingVoiceCall = {
  from: string
  accept: () => Promise<NativeVoiceCall>
  reject: () => Promise<void>
}

export type NativeVoiceCall = {
  disconnect: () => Promise<void>
  mute: (muted: boolean) => Promise<boolean>
  onEnded: (callback: () => void) => () => void
}

let voice: Voice | null = null
let token: string | null = null
let callerId: string | null = null
let outboundCallPending = false

function wrapCall(call: Call, sdk: typeof import('@twilio/voice-react-native-sdk'), onState?: (state: VoiceState) => void): NativeVoiceCall {
  const endedCallbacks = new Set<() => void>()
  const notifyEnded = () => {
    onState?.('ready')
    endedCallbacks.forEach((callback) => callback())
  }
  call.addListener(sdk.Call.Event.Ringing, () => onState?.('ringing'))
  call.addListener(sdk.Call.Event.Connected, () => onState?.('connected'))
  call.addListener(sdk.Call.Event.ConnectFailure, () => {
    onState?.('error')
    endedCallbacks.forEach((callback) => callback())
  })
  call.addListener(sdk.Call.Event.Disconnected, notifyEnded)
  return {
    disconnect: () => call.disconnect(),
    mute: (muted) => call.mute(muted),
    onEnded: (callback) => {
      endedCallbacks.add(callback)
      return () => {
        endedCallbacks.delete(callback)
      }
    },
  }
}

export async function registerTwilioVoice(input: {
  accessToken: string
  onIncoming: (call: IncomingVoiceCall) => void
  onState: (state: VoiceState) => void
}): Promise<{ callerId: string; displayName: string }> {
  input.onState('registering')
  const sdk = await import('@twilio/voice-react-native-sdk')
  const credentials = await fetchVoiceToken({ accessToken: input.accessToken })
  token = credentials.token
  callerId = credentials.callerId

  if (!voice) voice = new sdk.Voice()
  voice.removeAllListeners()
  voice.addListener(sdk.Voice.Event.Registered, () => input.onState('ready'))
  voice.addListener(sdk.Voice.Event.Unregistered, () => input.onState('offline'))
  voice.addListener(sdk.Voice.Event.Error, () => input.onState('error'))
  voice.addListener(sdk.Voice.Event.CallInvite, (invite: CallInvite) => {
    input.onState('ringing')
    input.onIncoming({
      from: invite.getFrom(),
      accept: async () => wrapCall(await invite.accept(), sdk, input.onState),
      reject: async () => {
        await invite.reject()
        input.onState('ready')
      },
    })
  })
  await voice.register(token)
  return { callerId: credentials.callerId, displayName: credentials.displayName }
}

export async function startTwilioVoiceCall(input: {
  accessToken: string
  phone: string
  contactName?: string | null
  leadId?: string | null
  prospectPhoneId?: string | null
  clientAttemptId?: string | null
  onState: (state: VoiceState) => void
}): Promise<NativeVoiceCall> {
  if (!voice || !token || !callerId) throw new Error('Phone is not registered. Open the Phone tab and retry.')
  if (outboundCallPending) throw new Error('A call is already starting.')
  outboundCallPending = true
  try {
    const phone = input.phone.replace(/[^\d+]/g, '')
    const clientAttemptId = input.clientAttemptId?.trim() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const kind = input.prospectPhoneId ? 'heir' : input.leadId ? 'lead' : 'manual'
    const authorized = await requestMobileCallIntent({
      accessToken: input.accessToken,
      phone,
      callerId,
      kind,
      leadId: kind === 'manual' ? null : input.leadId,
      prospectPhoneId: kind === 'heir' ? input.prospectPhoneId : null,
      clientAttemptId,
    })
    const sdk = await import('@twilio/voice-react-native-sdk')
    input.onState('connecting')
    const call = await voice.connect(token, {
      contactHandle: input.contactName || authorized.to,
      notificationDisplayName: 'SavingKC CRM',
      params: { To: authorized.to, CallerId: authorized.callerId, DialIntentToken: authorized.intent },
    })
    return wrapCall(call, sdk, input.onState)
  } finally {
    outboundCallPending = false
  }
}
