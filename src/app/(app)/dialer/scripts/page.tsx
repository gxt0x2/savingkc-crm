import { ScNav } from '@/components/smartercontact/sc-nav'
import { CallScriptsPanel } from '@/components/smartercontact/call-scripts-panel'

/** Standalone Dialer call-scripts manager. */
export default function DialerScriptsPage() {
  return (
    <div className="flex flex-col h-full">
      <ScNav />
      <div className="px-4 py-3 border-b border-[var(--ck-border)]">
        <h1 className="text-lg font-bold text-white">Call scripts</h1>
        <p className="text-sm text-[var(--ck-text-dim)]">
          Reusable scripts for your dialer sessions.
        </p>
      </div>
      <CallScriptsPanel />
    </div>
  )
}
