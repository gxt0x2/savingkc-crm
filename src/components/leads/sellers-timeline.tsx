'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface TimelineEvent {
  label: string
  date: string | null
  icon: string
  status: 'completed' | 'current' | 'upcoming' | 'skipped'
}

interface SellersTimelineProps {
  leadCreatedAt: string
  station: string | null
  activities: Array<{
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }>
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATION_ORDER = ['intake', 'not_contacted', 'contacted', 'qualifying', 'appt_set', 'negotiations', 'contract_signed']

export function SellersTimeline({ leadCreatedAt, station, activities }: SellersTimelineProps) {
  const [renderedAt] = useState(Date.now)
  // Derive timeline events from activities and station
  const currentStationIdx = STATION_ORDER.indexOf(station || 'intake')

  // Find key dates from activities
  const firstContact = activities.find(a => a.activity_type === 'call' || a.activity_type === 'sms')
  const appointmentSet = activities.find(a =>
    a.activity_type === 'status_change' && (a.metadata?.new_station === 'appt_set' || a.description?.toLowerCase().includes('appointment'))
  )
  const offerSent = activities.find(a =>
    a.activity_type === 'status_change' && (a.metadata?.new_station === 'negotiations' || a.description?.toLowerCase().includes('offer'))
  )
  const contractSigned = activities.find(a =>
    a.activity_type === 'status_change' && a.metadata?.new_station === 'contract_signed'
  )

  const events: TimelineEvent[] = [
    {
      label: 'Initial Contact',
      date: firstContact?.created_at || (currentStationIdx >= 2 ? leadCreatedAt : null),
      icon: 'call',
      status: currentStationIdx >= 2 ? 'completed' : currentStationIdx >= 1 ? 'current' : 'upcoming',
    },
    {
      label: 'Property Visit / Photos',
      date: appointmentSet?.created_at || null,
      icon: 'photo_camera',
      status: currentStationIdx >= 4 ? 'completed' : currentStationIdx >= 3 ? 'current' : 'upcoming',
    },
    {
      label: 'Offer Sent',
      date: offerSent?.created_at || null,
      icon: 'description',
      status: currentStationIdx >= 5 ? 'completed' : currentStationIdx >= 4 ? 'current' : 'upcoming',
    },
    {
      label: 'Target Close Date',
      date: contractSigned?.created_at || null,
      icon: 'handshake',
      status: currentStationIdx >= 6 ? 'completed' : 'upcoming',
    },
  ]

  // Calculate days in pipeline
  const daysInPipeline = Math.floor((renderedAt - new Date(leadCreatedAt).getTime()) / (1000 * 60 * 60 * 24))

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Icon name="timeline" className="!text-lg text-cyan-400" />
          <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
            Sellers Timeline
          </h2>
        </div>
        <span className="text-[10px] font-bold text-slate-400 bg-white/5 px-2 py-0.5 rounded-full">
          {daysInPipeline}d in pipeline
        </span>
      </div>

      <div className="space-y-0 relative">
        {events.map((event, idx) => {
          const isLast = idx === events.length - 1
          const isCompleted = event.status === 'completed'
          const isCurrent = event.status === 'current'

          return (
            <div key={event.label} className="flex gap-3 relative">
              {/* Connector line */}
              {!isLast && (
                <div className={`absolute left-[15px] top-[32px] w-[2px] h-[calc(100%)] ${
                  isCompleted ? 'bg-green-500/50' : 'bg-white/10'
                }`} />
              )}

              {/* Icon circle */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 ${
                isCompleted ? 'bg-green-500/20 border-2 border-green-500' :
                isCurrent ? 'bg-amber-500/20 border-2 border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]' :
                'bg-white/5 border-2 border-white/20'
              }`}>
                {isCompleted ? (
                  <Icon name="check" className="!text-sm text-green-400" />
                ) : (
                  <Icon name={event.icon} className={`!text-sm ${isCurrent ? 'text-amber-400' : 'text-slate-500'}`} />
                )}
              </div>

              {/* Content */}
              <div className={`pb-6 ${isLast ? 'pb-0' : ''}`}>
                <p className={`text-sm font-semibold ${
                  isCompleted ? 'text-white' : isCurrent ? 'text-amber-300' : 'text-slate-500'
                }`}>
                  {event.label}
                </p>
                <p className={`text-xs ${isCompleted ? 'text-green-400/80' : 'text-slate-500'}`}>
                  {event.date ? formatDate(event.date) : isCurrent ? 'In progress' : 'Pending'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
