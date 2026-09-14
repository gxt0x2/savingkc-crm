const MICROPHONE_BLOCKED_MESSAGE = 'Microphone access is blocked for this CRM. Allow it in Chrome site controls, then reconnect the phone.'
const MICROPHONE_MISSING_MESSAGE = 'No microphone is available. Connect or select a microphone, then reconnect the phone.'
const MICROPHONE_UNAVAILABLE_MESSAGE = 'The selected microphone is unavailable or already in use. Check the headset, then reconnect the phone.'

export const MICROPHONE_SILENCE_MESSAGE = 'Your microphone is not sending audio. Check mute, then choose and test a microphone in the dialer before continuing.'

type MicrophoneMediaDevices = Pick<MediaDevices, 'getUserMedia'>

function errorName(error: unknown): string {
  if (!error || typeof error !== 'object' || !('name' in error)) return ''
  return typeof error.name === 'string' ? error.name : ''
}

export function microphoneFailureMessage(error: unknown): string {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return MICROPHONE_BLOCKED_MESSAGE
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return MICROPHONE_MISSING_MESSAGE
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return MICROPHONE_UNAVAILABLE_MESSAGE
    default:
      return error instanceof Error && error.message
        ? error.message
        : MICROPHONE_UNAVAILABLE_MESSAGE
  }
}

export async function verifyMicrophoneInput(
  mediaDevices: MicrophoneMediaDevices | null | undefined = typeof navigator === 'undefined'
    ? null
    : navigator.mediaDevices,
): Promise<void> {
  if (!mediaDevices?.getUserMedia) throw new Error(MICROPHONE_MISSING_MESSAGE)

  let stream: MediaStream | null = null
  try {
    stream = await mediaDevices.getUserMedia({ audio: true })
    const liveTrack = stream.getAudioTracks().find((track) => track.enabled && track.readyState === 'live')
    if (!liveTrack) throw new Error(MICROPHONE_UNAVAILABLE_MESSAGE)
  } catch (error) {
    throw new Error(microphoneFailureMessage(error))
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
  }
}
