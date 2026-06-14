'use client'

import { type ReactNode, useState } from 'react'
import { trackEvent } from './track-events'

export default function ShareButton({
  slug,
  className,
  toastClassName,
  children,
  ariaLabel = 'Share',
}: {
  slug?: string
  className?: string
  toastClassName?: string
  children?: ReactNode
  ariaLabel?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    // Generate a simple share code so visits via this link can be attributed
    const shareCode = Math.random().toString(36).slice(2, 10)
    const url = new URL(window.location.href)
    url.searchParams.set('s', shareCode)

    if (slug) {
      trackEvent(slug, 'share_click', {
        section: 'pricing_sidebar',
        cta_id: 'deal_share',
        cta_label: 'Share',
        destination: 'share_link',
        share_code: shareCode,
      })
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: document.title || 'Saving KC deal',
          url: url.toString(),
        })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    await navigator.clipboard?.writeText(url.toString()).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <button
        onClick={handleShare}
        className={className ?? 'w-full flex items-center justify-center gap-2 border border-[#ddd] text-[#444] hover:border-[#bbb] hover:bg-[#fafafa] rounded-xl px-4 py-2.5 text-[14px] font-medium transition-all'}
        aria-label={ariaLabel}
      >
        {children ?? (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            {copied ? 'Copied!' : 'Share'}
          </>
        )}
      </button>
      {copied && (
        <div className={toastClassName ?? 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1a1a1a] text-white text-[13px] font-medium px-5 py-3 rounded-xl shadow-lg flex items-center gap-2'}>
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Link copied to clipboard
        </div>
      )}
    </>
  )
}
