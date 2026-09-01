import { useEffect, useState } from 'react'

export function useCallTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const reset = window.setTimeout(() => setSeconds(0), 0)
    if (!active) return () => window.clearTimeout(reset)
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => {
      window.clearTimeout(reset)
      window.clearInterval(id)
    }
  }, [active])

  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
