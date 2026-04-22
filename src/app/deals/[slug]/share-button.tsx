'use client'

import { useState } from 'react'

export default function ShareButton() {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <button
        onClick={handleCopy}
        className="w-full flex items-center justify-center gap-2 border border-[#ddd] text-[#444] hover:border-[#bbb] hover:bg-[#fafafa] rounded-xl px-4 py-2.5 text-[14px] font-medium transition-all"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
        </svg>
        {copied ? 'Copied!' : 'Share'}
      </button>
      {copied && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1a1a1a] text-white text-[13px] font-medium px-5 py-3 rounded-xl shadow-lg flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Link copied to clipboard
        </div>
      )}
    </>
  )
}
