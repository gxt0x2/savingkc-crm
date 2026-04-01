'use client'

/** Stub — Dialer drawer placeholder */
export function DialerDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-96 bg-white shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">Dialer</h2>
        <p className="text-sm text-slate-500">Dialer coming soon.</p>
      </div>
    </div>
  )
}
