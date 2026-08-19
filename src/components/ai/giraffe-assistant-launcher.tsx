'use client'

import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useState } from 'react'

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
      className="fixed bottom-5 right-5 z-[90] hidden h-16 w-16 place-items-center overflow-hidden rounded-full border-2 border-[var(--crm-warning-border)] bg-[#fffdf8] shadow-[0_10px_30px_rgba(32,33,36,.28)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(32,33,36,.34)] focus:outline-none focus:ring-4 focus:ring-[var(--crm-violet-soft)] lg:grid"
    >
      <Image src="/ai/giraffe-assistant.webp" alt="AI Assistant giraffe" fill sizes="64px" className="object-cover" priority={false} />
      <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[var(--crm-success)]" />
    </button>
  )
}
