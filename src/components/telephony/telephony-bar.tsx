'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'

type CallStatus = 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TwilioDevice = any

function useCallTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) { setSeconds(0); return }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function TelephonyBar() {
  const [status, setStatus] = useState<CallStatus>('offline')
  const [dialNumber, setDialNumber] = useState('')
  const [showDial, setShowDial] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [twimlAppSid, setTwimlAppSid] = useState<string | null>(null)
  const deviceRef = useRef<TwilioDevice>(null)
  const callRef = useRef<TwilioDevice>(null)
  const callTimer = useCallTimer(status === 'on_call')

  function log(msg: string) {
    console.log(`[TelephonyBar] ${msg}`)
  }

  const setStatusLogged = useCallback((s: CallStatus) => {
    log(`status → ${s}`)
    setStatus(s)
  }, [])

  const initDevice = useCallback(async () => {
    setStatusLogged('connecting')
    setError(null)
    try {
      log('fetching token...')
      const { Device } = await import('@twilio/voice-sdk')
      const res = await fetch('/api/twilio-token')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const { token, twimlAppSid: appSid } = data
      log(`token received, twimlAppSid=${appSid}`)
      setTwimlAppSid(appSid || null)

      const device = new Device(token, { logLevel: 1 })
      deviceRef.current = device

      device.on('registered', () => setStatusLogged('ready'))
      device.on('unregistered', () => setStatusLogged('offline'))
      device.on('error', (err: Error) => {
        log(`device error: ${err?.message}`)
        setError(err?.message || 'Device error')
        setStatusLogged('offline')
      })
      device.on('incoming', (call: TwilioDevice) => {
        log('incoming call')
        callRef.current = call
        setStatusLogged('incoming')
        call.on('disconnect', () => { callRef.current = null; setStatusLogged('ready') })
        call.on('cancel', () => { callRef.current = null; setStatusLogged('ready') })
      })

      log('registering device...')
      await device.register()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`init error: ${msg}`)
      setError(msg)
      setStatusLogged('offline')
    }
  }, [setStatusLogged])

  async function setupTwiml() {
    log('calling /api/setup-twilio...')
    setError(null)
    try {
      const res = await fetch('/api/setup-twilio')
      const data = await res.json()
      log(`setup-twilio result: ${JSON.stringify(data)}`)
      setTwimlAppSid(data.appSid || null)
      // Re-init device after setup
      await initDevice()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Setup failed: ${msg}`)
    }
  }

  useEffect(() => {
    initDevice()
    return () => {
      deviceRef.current?.destroy()
    }
  }, [initDevice])

  const callStartRef = useRef<number>(0)

  async function makeCall() {
    if (!deviceRef.current || !dialNumber.trim()) return
    setStatusLogged('calling')
    setShowDial(false)
    setError(null)
    log(`calling ${dialNumber.trim()}`)
    try {
      const call = await deviceRef.current.connect({
        params: { To: dialNumber.trim() },
      })
      callRef.current = call
      callStartRef.current = Date.now()
      setStatusLogged('on_call')

      // Log call started
      fetch('/api/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: dialNumber.trim(), event: 'started', agent: 'Ernest' }),
      }).catch(() => {})

      call.on('disconnect', () => {
        const duration = Math.round((Date.now() - callStartRef.current) / 1000)
        fetch('/api/call-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: dialNumber.trim(), event: 'ended', duration, agent: 'Ernest' }),
        }).catch(() => {})
        callRef.current = null; setStatusLogged('ready'); setMuted(false)
      })
      call.on('cancel', () => { callRef.current = null; setStatusLogged('ready'); setMuted(false) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`makeCall error: ${msg}`)
      setError(msg)
      setStatusLogged('ready')
    }
  }

  function hangup() {
    callRef.current?.disconnect()
    callRef.current = null
    setStatusLogged('ready')
    setMuted(false)
  }

  function acceptIncoming() {
    callRef.current?.accept()
    setStatusLogged('on_call')
  }

  function rejectIncoming() {
    callRef.current?.reject()
    callRef.current = null
    setStatusLogged('ready')
  }

  function toggleMute() {
    if (!callRef.current) return
    callRef.current.mute(!muted)
    setMuted(!muted)
  }

  const statusColor: Record<CallStatus, string> = {
    offline: 'bg-slate-100 text-slate-400',
    connecting: 'bg-yellow-100 text-yellow-600',
    ready: 'bg-emerald-100 text-secondary',
    calling: 'bg-blue-100 text-blue-600',
    on_call: 'bg-emerald-100 text-secondary',
    incoming: 'bg-orange-100 text-orange-600',
  }

  const statusLabel: Record<CallStatus, string> = {
    offline: 'Offline',
    connecting: 'Connecting...',
    ready: 'Ready',
    calling: 'Calling...',
    on_call: `On Call ${callTimer}`,
    incoming: 'Incoming Call',
  }

  const isDev = process.env.NODE_ENV === 'development'

  return (
    <>
      {/* Dev Debug Panel */}
      {isDev && (
        <div className="fixed bottom-24 left-4 z-50 bg-black/80 text-green-400 text-[10px] font-mono p-2 rounded-lg max-w-xs">
          <div>status: {status}</div>
          <div>twimlApp: {twimlAppSid || 'none'}</div>
          {error && <div className="text-red-400">error: {error}</div>}
        </div>
      )}

      {/* Error Toast */}
      {error && status === 'offline' && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg max-w-sm text-center">
          {error}
        </div>
      )}

      {/* Dial Dialog */}
      {showDial && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/30" onClick={() => setShowDial(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-primary mb-3">New Call</h3>
            <input
              type="tel"
              autoFocus
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && makeCall()}
              className="w-full border border-slate-200 rounded-lg px-4 py-3 text-lg font-mono tracking-widest mb-4 focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="+1 (816) 555-0000"
            />
            <div className="flex gap-3">
              <button onClick={makeCall} className="flex-1 bg-secondary text-white font-bold py-2.5 rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                <Icon name="call" size="text-sm" />
                Call
              </button>
              <button onClick={() => setShowDial(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-50 rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telephony Bar */}
      <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-2rem)] sm:w-auto max-w-[600px]">
        <div className="glass-telephony px-4 sm:px-6 py-3 rounded-full flex items-center gap-4 sm:gap-6 shadow-[0_8px_24px_rgba(25,28,29,0.12)] border border-outline-variant/10 overflow-x-auto">
          {/* Status */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center ${statusColor[status]}`}>
              <Icon name="call" filled size="text-[18px]" />
            </div>
            <div className="flex-col hidden sm:flex">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Status</span>
              <span className="text-xs font-bold text-primary">{statusLabel[status]}</span>
            </div>
            {/* Mobile: show status label inline */}
            <span className="text-xs font-bold text-primary sm:hidden">{statusLabel[status]}</span>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-outline-variant/20 hidden sm:block flex-shrink-0" />

          {/* Ari Indicator */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <div className="w-2.5 h-2.5 bg-secondary rounded-full shadow-[0_0_8px_#006e2f]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">Ari Active</span>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-outline-variant/20 hidden sm:block flex-shrink-0" />

          {/* Actions */}
          <div className="flex items-center gap-3 sm:gap-4 ml-auto flex-shrink-0">
            {status === 'incoming' ? (
              <>
                <button onClick={acceptIncoming} className="px-4 py-2 bg-secondary text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-colors flex items-center gap-1.5">
                  <Icon name="call" size="text-sm" />
                  <span className="hidden sm:inline">Accept</span>
                </button>
                <button onClick={rejectIncoming} className="px-4 py-2 bg-red-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors flex items-center gap-1.5">
                  <Icon name="call_end" size="text-sm" />
                  <span className="hidden sm:inline">Reject</span>
                </button>
              </>
            ) : status === 'on_call' || status === 'calling' ? (
              <>
                <button onClick={toggleMute} className={`p-2 rounded-full transition-colors ${muted ? 'text-red-500 bg-red-50' : 'text-slate-400 hover:text-primary'}`}>
                  <Icon name={muted ? 'mic_off' : 'mic'} />
                </button>
                <button onClick={hangup} className="px-4 sm:px-5 py-2 bg-red-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors flex items-center gap-1.5">
                  <Icon name="call_end" size="text-sm" />
                  <span className="hidden sm:inline">Hang Up</span>
                </button>
              </>
            ) : (
              <>
                <button
                  className="text-slate-400 hover:text-primary transition-colors hidden sm:flex"
                  onClick={status === 'offline' ? setupTwiml : initDevice}
                  title={status === 'offline' ? 'Setup & Reconnect' : 'Reconnect'}
                >
                  <Icon name="refresh" />
                </button>
                <button
                  data-telephony-dial
                  onClick={() => setShowDial(true)}
                  disabled={status === 'connecting' || status === 'offline'}
                  className="px-4 sm:px-6 py-2.5 bg-secondary text-white rounded-full flex items-center gap-1.5 sm:gap-2 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon name="add_call" size="text-sm" />
                  <span>New Call</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
