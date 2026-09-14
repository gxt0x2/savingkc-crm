import type { Call } from '@twilio/voice-sdk'

type RingbackControls = {
  play: () => Promise<void>
  stop: () => void
  log: (message: string) => void
}

/** Remote media owns ringback once present, including during its silent gaps. */
export function bindCallRingback(call: Pick<Call, 'on' | 'removeListener'>, controls: RingbackControls) {
  let remoteMedia = false
  let localPlaying = false
  let finished = false
  const handOffToRemoteMedia = () => {
    if (finished || remoteMedia) return
    remoteMedia = true
    localPlaying = false
    controls.stop()
    controls.log('ringback: remote audio')
  }
  const onRinging = (hasEarlyMedia: boolean) => {
    if (finished) return
    if (hasEarlyMedia) handOffToRemoteMedia()
    if (remoteMedia || localPlaying) return
    localPlaying = true
    controls.log('ringback: local fallback')
    void controls.play()
  }
  // Some carriers start media after the initial ringing signal. Only measure
  // remote output: microphone noise must not turn off fallback ringing.
  const onVolume = (_input: number, output: number) => {
    if (output > 0.001) handOffToRemoteMedia()
  }
  const finish = () => {
    if (finished) return
    finished = true
    controls.stop()
    call.removeListener('ringing', onRinging)
    call.removeListener('volume', onVolume)
    for (const event of ['accept', 'disconnect', 'cancel', 'reject', 'error']) {
      call.removeListener(event, finish)
    }
  }
  call.on('ringing', onRinging)
  call.on('volume', onVolume)
  for (const event of ['accept', 'disconnect', 'cancel', 'reject', 'error']) {
    call.on(event, finish)
  }
  return finish
}
