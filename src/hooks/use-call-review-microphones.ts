'use client'

import { useEffect, useState } from 'react'

type MicrophoneOption = Pick<MediaDeviceInfo, 'deviceId' | 'label'>

export function useCallReviewMicrophones(active: boolean) {
  const [devices, setDevices] = useState<MicrophoneOption[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  useEffect(() => {
    if (!active || !navigator.mediaDevices?.enumerateDevices) return
    let cancelled = false
    const refresh = async () => {
      try {
        const inputs = (await navigator.mediaDevices.enumerateDevices())
          .filter((device) => device.kind === 'audioinput' && device.deviceId)
          .map(({ deviceId, label }) => ({ deviceId, label: label || 'Microphone' }))
        if (cancelled) return
        setDevices(inputs)
        setSelectedDeviceId((current) => current && inputs.some((device) => device.deviceId === current) ? current : inputs.find((device) => device.deviceId === 'default')?.deviceId || inputs[0]?.deviceId || '')
      } catch {
        if (!cancelled) setDevices([])
      }
    }
    void refresh()
    navigator.mediaDevices.addEventListener?.('devicechange', refresh)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh)
    }
  }, [active])

  return { devices, selectedDeviceId, setSelectedDeviceId }
}
