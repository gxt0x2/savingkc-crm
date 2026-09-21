'use client'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Device } from '@twilio/voice-sdk'
import { chooseMicrophone, preferredMicrophone, testSelectedMicrophone } from '@/lib/telephony/selected-microphone'

type Props = { deviceRef: RefObject<Device | null>; status: string; open: boolean }
const SESSION_CHECK_PREFIX = 'savingkc:dialer-microphone-check:v1:'

function microphoneCheckCompleted(sessionId: string | null): boolean {
  if (!sessionId || typeof window === 'undefined') return false
  try { return window.sessionStorage.getItem(`${SESSION_CHECK_PREFIX}${sessionId}`) === 'complete' } catch { return false }
}

export function DialerMicrophoneControls({ deviceRef, status, open, sessionId = null, workspace = false }: Props & { sessionId?: string | null; workspace?: boolean }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selected, setSelected] = useState('default')
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [message, setMessage] = useState('Choose your microphone and test it before calling.')
  const [completedSessionId, setCompletedSessionId] = useState<string | null>(() => microphoneCheckCompleted(sessionId) ? sessionId : null)
  const abortRef = useRef<AbortController | null>(null)
  const completed = Boolean(sessionId && completedSessionId === sessionId)
  useEffect(() => {
    setCompletedSessionId(microphoneCheckCompleted(sessionId) ? sessionId : null)
  }, [sessionId])
  useEffect(() => {
    if (!open || status !== 'ready') return
    let cancelled = false
    const refresh = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const inputs = all.filter(d => d.kind === 'audioinput')
        setDevices(inputs)
        const preferred = preferredMicrophone()
        if (preferred !== 'default' && !inputs.some(d => d.deviceId === preferred)) {
          setSelected('default')
          try { if (deviceRef.current) chooseMicrophone(deviceRef.current, 'default') } catch { /* keep default even if the SDK is not ready */ }
          setMessage('Previous microphone is unavailable. Browser default selected. Test it before calling.')
          return
        }
        setSelected(preferred)
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
      if (!controller.signal.aborted && maximum >= 0.003) {
        if (sessionId) {
          try { window.sessionStorage.setItem(`${SESSION_CHECK_PREFIX}${sessionId}`, 'complete') } catch { /* the in-memory session state still hides the completed check */ }
          setCompletedSessionId(sessionId)
        } else {
          setMessage('Input signal detected. Confirm two-way speech with a test call.')
        }
      } else if (!controller.signal.aborted) {
        setMessage('No usable input signal detected. Select another microphone and test again.')
      }
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Microphone check failed.') }
    finally { if (abortRef.current === controller) { abortRef.current = null; setTesting(false); setLevel(0) } }
  }
  if (completed) return null

  const sectionClass = workspace
    ? 'space-y-2 rounded-xl border border-[var(--prospecting-border)] bg-[var(--prospecting-elevated)] p-3 text-[var(--prospecting-text)]'
    : 'space-y-2 rounded-[var(--skc-radius-control)] border border-[var(--skc-separator)] bg-[var(--skc-surface-2)] p-3 text-[var(--skc-text-primary)]'
  const selectClass = workspace
    ? 'mt-1 w-full rounded-lg border border-[var(--prospecting-border-strong)] bg-[var(--prospecting-panel)] p-2 text-xs font-semibold text-[var(--prospecting-text)]'
    : 'mt-1 w-full rounded border border-[var(--skc-separator)] bg-[var(--skc-surface-2)] p-2 text-xs text-[var(--skc-text-primary)]'

  return <section className={sectionClass} aria-label="Microphone check">
    <label className="block text-xs font-semibold">Call microphone
      <select aria-label="Call microphone" className={selectClass} value={selected} disabled={busy} onChange={event => {
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
      <button type="button" disabled={status !== 'ready'} className={workspace ? 'shrink-0 rounded-lg border border-[var(--prospecting-border-strong)] bg-[var(--prospecting-panel)] px-2.5 py-1.5 text-xs font-bold text-[var(--prospecting-text)] disabled:opacity-50' : 'shrink-0 rounded border border-[var(--skc-separator)] px-2 py-1 text-xs font-semibold text-[var(--skc-text-primary)] disabled:opacity-50'} onClick={() => testing ? abortRef.current?.abort() : void test()}>{testing ? 'Stop check' : 'Test microphone'}</button>
      <meter aria-label="Microphone input level" className="h-3 w-full" min={0} max={1} value={Math.min(1, level * 10)} />
    </div>
    <p role="status" className={workspace ? 'text-xs leading-4 text-[var(--prospecting-muted)]' : 'text-xs text-[var(--skc-text-secondary)]'}>{message}</p>
  </section>
}
