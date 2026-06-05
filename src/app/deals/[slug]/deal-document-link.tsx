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
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#f0f0f0] hover:border-[#ddd] hover:bg-[#fafafa] transition-all"
      onClick={() => {
        trackEvent(slug, 'deal_document_open', {
          section: 'documents',
          cta_id: documentId(name, index),
          cta_label: name,
          document_id: documentId(name, index),
          document_name: name,
          destination: 'document',
          position: index + 1,
        })
      }}
    >
      <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-[#1a1a1a] truncate">{name}</p>
        <p className="text-[12px] text-[#999]">PDF</p>
      </div>
      <svg className="w-4 h-4 text-[#bbb] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    </a>
  )
}
