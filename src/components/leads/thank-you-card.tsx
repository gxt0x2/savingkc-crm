'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { toProperCase } from '@/lib/format'

interface ThankYouCardProps {
  leadId: string
}

export function ThankYouCard({ leadId }: ThankYouCardProps) {
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [leadName, setLeadName] = useState<string | null>(null)

  useEffect(() => {
    async function check() {
      const supabase = createClient()
      const [{ data: activities }, { data: lead }] = await Promise.all([
        supabase
          .from('lead_activities')
          .select('id')
          .eq('lead_id', leadId)
          .eq('activity_type', 'letter_tracking')
          .limit(1),
        supabase
          .from('leads')
          .select('full_name')
          .eq('id', leadId)
          .single(),
      ])
      if (activities && activities.length > 0) setSent(true)
      if (lead) setLeadName(lead.full_name)
    }
    check()
  }, [leadId])

  async function handleSend() {
    if (sent || sending) return
    setSending(true)
    const supabase = createClient()
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'letter_tracking',
      description: `Thank you letter sent to ${toProperCase(leadName)}`,
      agent: 'User',
      metadata: { letter_type: 'thank_you', sent_date: new Date().toISOString() },
    })
    setSent(true)
    setSending(false)
  }

  return (
    <div className={`rounded-2xl p-5 transition-all ${sent ? 'bg-green-50 border border-green-200' : 'bg-[#1B2A4A]'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon name={sent ? 'check_circle' : 'mail'} className={sent ? 'text-green-500' : 'text-amber-400'} />
        <h3 className={`text-sm font-black uppercase tracking-wider ${sent ? 'text-green-700' : 'text-white'}`}>
          Thank You Letter
        </h3>
      </div>
      {sent ? (
        <p className="text-sm text-green-600 font-medium">Letter has been sent</p>
      ) : (
        <button
          onClick={handleSend}
          disabled={sending}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Icon name="send" size="text-sm" />
          {sending ? 'Sending...' : 'Mark as Sent'}
        </button>
      )}
    </div>
  )
}
