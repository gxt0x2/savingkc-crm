'use client'

import { trackEvent } from './track-events'

interface DealDocumentLinkProps {
  slug: string
  name: string
  url: string
  index: number
}

function documentId(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `inspection_report_${slug || index + 1}`
}

export function DealDocumentLink({ slug, name, url, index }: DealDocumentLinkProps) {
  const displayName = 'Inspection Report'

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#fed7aa] bg-[#fff7ed] text-[#9a3412] transition-all hover:border-[#fdba74] hover:bg-[#ffedd5]"
      onClick={() => {
        trackEvent(slug, 'deal_document_open', {
          section: 'documents',
          cta_id: documentId(name, index),
          cta_label: displayName,
          document_id: documentId(name, index),
          document_name: name,
          document_label: displayName,
          destination: 'document',
          position: index + 1,
        })
      }}
    >
      <svg className="w-5 h-5 text-[#ea580c] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 21 19.5H3L12 3.75Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4.25M12 16.25h.01" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-[#1a1a1a] truncate">{displayName}</p>
      </div>
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ea580c]">View Report</span>
    </a>
  )
}
