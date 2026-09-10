'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { AssistantMark } from '@/components/ai/assistant-mark'

const GiraffeAssistant = dynamic(
  () => import('./giraffe-assistant').then((module) => module.GiraffeAssistant),
  { ssr: false },
)

export function GiraffeAssistantLauncher() {
  const [activated, setActivated] = useState(false)

  if (activated) return <GiraffeAssistant initialOpen />

  return (
    <button
      type="button"
      onClick={() => setActivated(true)}
      aria-label="Open AI Assistant"
      aria-expanded={false}
      className="fixed bottom-5 right-5 z-[90] hidden h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-[#171916] shadow-[0_14px_36px_rgba(16,18,16,.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(16,18,16,.34)] focus:outline-none focus:ring-4 focus:ring-[var(--crm-brand-soft)] lg:grid"
    >
      <AssistantMark live className="h-full w-full rounded-2xl" />
    </button>
  )
}
