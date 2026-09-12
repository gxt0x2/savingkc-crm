'use client'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Device } from '@twilio/voice-sdk'
import { chooseMicrophone, preferredMicrophone, testSelectedMicrophone } from '@/lib/telephony/selected-microphone'

type Props = { deviceRef: RefObject<Device | null>; status: string; open: boolean }
export function DialerMicrophoneControls({ deviceRef, status, open }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selected, setSelected] = useState('default')
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [message, setMessage] = useState('Choose your microphone and test it before calling.')
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!open || status !== 'ready') return
    let cancelled = false
    const refresh = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) { setDevices(all.filter(d => d.kind === 'audioinput')); setSelected(preferredMicrophone()) }
      } catch { if (!cancelled) setMessage('Could not list microphones. Reconnect the phone.') }
    }
    void refresh()
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => { cancelled = true; navigator.mediaDevices?.removeEventListener('devicechange', refresh) }
  }, [open, status])
  useEffect(() => {
    if (!open) abortRef.current?.abort()
    return () => { abortRef.current?.abort() }
  }, [open])
  const busy = status !== 'ready' || testing
  async function test() {
    const device = deviceRef.current
    if (!device || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setTesting(true); setLevel(0); setMessage('Speak toward the selected microphone for six seconds…')
    try {
      const maximum = await testSelectedMicrophone(device, setLevel, controller.signal)
      if (!controller.signal.aborted) setMessage(maximum >= 0.003
        ? 'Input signal detected. Confirm two-way speech with a test call.'
        : 'No usable input signal detected. Select another microphone and test again.')
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Microphone check failed.') }
    finally { if (abortRef.current === controller) { abortRef.current = null; setTesting(false); setLevel(0) } }
  }
  return <section className="space-y-2 rounded-[var(--skc-radius-control)] border border-[var(--skc-separator)] p-3" aria-label="Microphone settings">
    <label className="block text-xs font-semibold text-[var(--skc-text-primary)]">Microphone
      <select aria-label="Call microphone" className="mt-1 w-full rounded border border-[var(--skc-separator)] bg-[var(--skc-surface-2)] p-2 text-xs text-[var(--skc-text-primary)]" value={selected} disabled={busy} onChange={event => {
        const device = deviceRef.current
        if (!device) return
        try { chooseMicrophone(device, event.target.value); setSelected(event.target.value); setMessage('Microphone selected. Test its input before calling.') }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Could not select microphone.') }
      }}>
        <option value="default">Browser default</option>
        {devices.filter(d => d.deviceId !== 'default').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
        {selected !== 'default' && !devices.some(d => d.deviceId === selected) && <option value={selected}>Selected microphone unavailable</option>}
      </select>
    </label>
    <div className="flex items-center gap-3">
      <button type="button" disabled={status !== 'ready'} className="shrink-0 rounded border border-[var(--skc-separator)] px-2 py-1 text-xs font-semibold text-[var(--skc-text-primary)] disabled:opacity-50" onClick={() => testing ? abortRef.current?.abort() : void test()}>{testing ? 'Stop check' : 'Test microphone'}</button>
      <meter aria-label="Microphone input level" className="h-3 w-full" min={0} max={1} value={Math.min(1, level * 10)} />
    </div>
    <p role="status" className="text-xs text-[var(--skc-text-secondary)]">{message}</p>
  </section>
}
