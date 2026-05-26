'use client'

import { useState } from 'react'
import { trackEvent } from './track-events'

const input = 'w-full border border-[#e0e0e0] rounded-xl px-3.5 py-2.5 text-[14px] text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 transition-colors placeholder:text-[#ccc]'

interface InquiryModalProps {
  propertyAddress: string
  slug?: string
}

export default function InquiryModal({ propertyAddress, slug }: InquiryModalProps) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    message: '',
  })

  const toEmail = 'ernest@savingkc.com'
  const subject = `Info: ${propertyAddress}`

  function handleOpen() {
    if (!open && slug) {
      trackEvent(slug, 'inquiry_modal_open')
    }
    setOpen(true)
  }

  function handleSend() {
    const body = form.message || `Hi, I'm interested in learning more about ${propertyAddress}.`
    if (slug) {
      trackEvent(slug, 'inquiry_submit', {
        has_name: Boolean(form.name.trim()),
        has_email: Boolean(form.email.trim()),
        has_message: Boolean(form.message.trim()),
      })
    }
    const mailto = `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(form.name ? `From: ${form.name}\n${form.email ? `Email: ${form.email}\n` : ''}\n${body}` : body)}`
    window.open(mailto, '_blank')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-center gap-2 border border-[#ddd] text-[#444] hover:border-[#bbb] hover:bg-[#fafafa] rounded-xl px-4 py-2.5 text-[14px] font-medium transition-all"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
        Send Inquiry
      </button>
    )
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-center gap-2 border border-[#ddd] text-[#444] hover:border-[#bbb] hover:bg-[#fafafa] rounded-xl px-4 py-2.5 text-[14px] font-medium transition-all"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
        Send Inquiry
      </button>

      {/* Modal backdrop */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#eaeaea]"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-5 border-b border-[#f0f0f0]">
            <h2 className="text-[17px] font-semibold text-[#1a1a1a]">Send Inquiry</h2>
            <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-[#f5f5f5] rounded-lg text-[#999] transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-[#666] mb-1.5">To</label>
              <div className="text-[14px] text-[#1a1a1a] bg-[#fafafa] border border-[#f0f0f0] rounded-xl px-3.5 py-2.5">{toEmail}</div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#666] mb-1.5">Subject</label>
              <div className="text-[14px] text-[#1a1a1a] bg-[#fafafa] border border-[#f0f0f0] rounded-xl px-3.5 py-2.5">{subject}</div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#666] mb-1.5">Your Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                className={input}
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#666] mb-1.5">Your Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                className={input}
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#666] mb-1.5">Message</label>
              <textarea
                rows={3}
                value={form.message}
                onChange={e => setForm(prev => ({ ...prev, message: e.target.value }))}
                className={`${input} resize-none`}
                placeholder={`Hi, I'm interested in learning more about this property...`}
              />
            </div>
          </div>

          <div className="px-6 pb-6 flex gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 border border-[#ddd] text-[#444] hover:bg-[#fafafa] rounded-xl px-4 py-2.5 text-[14px] font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              className="flex-1 bg-[#1a1a1a] text-white hover:bg-[#333] rounded-xl px-4 py-2.5 text-[14px] font-semibold transition-colors"
            >
              Open in Email
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
