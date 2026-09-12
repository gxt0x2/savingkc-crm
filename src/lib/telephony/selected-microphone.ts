import type { Device, Call } from '@twilio/voice-sdk'
import { microphoneFailureMessage } from './microphone-preflight'

const STORAGE_KEY = 'savingkc.voice.microphone.v1'
const owners = new WeakMap<Device, 'call' | 'test'>()
export function preferredMicrophone(): string {
  try { return localStorage.getItem(STORAGE_KEY) || 'default' } catch { return 'default' }
}
export function chooseMicrophone(device: Device, id: string): void {
  if (owners.has(device)) throw new Error('Finish the call or microphone check before changing microphones.')
  localStorage.setItem(STORAGE_KEY, id)
}
async function bindMicrophone(device: Device): Promise<MediaStream> {
  const audio = device.audio
  if (!audio) throw new Error('Phone audio is unavailable. Reconnect the phone.')
  try {
    // Bind the SDK's own input stream. A separate getUserMedia probe cannot
    // establish which microphone the SDK will use when the call starts.
    await audio.setInputDevice(preferredMicrophone())
    const stream = audio.inputStream
    const track = stream?.getAudioTracks().find(t => t.enabled && !t.muted && t.readyState === 'live')
    if (!stream || !track) throw new Error('The selected microphone is not available. Choose another microphone.')
    return stream
  } catch (error) { throw new Error(microphoneFailureMessage(error)) }
}
async function release(device: Device, owner: 'call' | 'test'): Promise<void> {
  if (owners.get(device) !== owner) return
  // Keep the lock until the asynchronous SDK release has finished.
  try { await device.audio?.unsetInputDevice() } finally { owners.delete(device) }
}
export async function prepareCallMicrophone(device: Device): Promise<void> {
  if (owners.has(device)) throw new Error('Finish the microphone check or current call before dialing.')
  owners.set(device, 'call')
  try { await bindMicrophone(device) } catch (error) {
    await release(device, 'call').catch(() => {})
    throw error
  }
}
export function releaseCallMicrophone(device: Device): Promise<void> { return release(device, 'call') }
export function monitorCallMicrophone(device: Device, call: Call): void {
  const end = () => { void releaseCallMicrophone(device).catch(() => {}) }
  call.once('disconnect', end)
  call.once('cancel', end)
  call.once('reject', end)
  // This is the stream actually attached to the call, not the permission probe.
  call.once('accept', () => {
    const track = call.getLocalStream()?.getAudioTracks()[0]
    console.info('[DialerAudio] call input', { label: track?.label, enabled: track?.enabled, muted: track?.muted, state: track?.readyState })
  })
}
export async function testSelectedMicrophone(
  device: Device, onLevel: (rms: number) => void, signal: AbortSignal,
): Promise<number> {
  if (owners.has(device)) throw new Error('Finish the current call or microphone check first.')
  owners.set(device, 'test')
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let peakRms = 0
  try {
    const stream = await bindMicrophone(device)
    if (signal.aborted) return 0
    context = new AudioContext()
    await context.resume()
    source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const values = new Float32Array(analyser.fftSize)
    const until = Date.now() + 6000
    while (!signal.aborted && Date.now() < until) {
      analyser.getFloatTimeDomainData(values)
      const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)
      peakRms = Math.max(peakRms, rms)
      onLevel(rms)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return peakRms
  } finally {
    source?.disconnect()
    await context?.close().catch(() => {})
    await release(device, 'test').catch(() => {})
  }
}
