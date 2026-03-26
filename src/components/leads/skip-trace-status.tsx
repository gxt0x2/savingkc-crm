// SKP-01: Skip Trace Status Section
// Night 4 Phase 1: Property Dossier

import { Icon } from '@/components/ui/icon'

export interface SkipTracePhone {
  number: string
  type: 'mobile' | 'landline' | 'voip'
  attempted: boolean
  last_disposition?: string
  last_attempt_date?: string
}

export interface SkipTraceData {
  last_traced_date: string | null
  phones: SkipTracePhone[]
  needs_retrace?: boolean
}

interface SkipTraceStatusProps {
  data: SkipTraceData
  onRetrace?: () => void
}

export function SkipTraceStatus({ data, onRetrace }: SkipTraceStatusProps) {
  const daysSinceTrace = data.last_traced_date
    ? Math.floor((Date.now() - new Date(data.last_traced_date).getTime()) / (1000 * 60 * 60 * 24))
    : null

  const needsRetrace = data.needs_retrace || (daysSinceTrace !== null && daysSinceTrace > 90)

  const attemptedCount = data.phones.filter(p => p.attempted).length
  const unattemptedCount = data.phones.length - attemptedCount

  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary">
            Skip Trace
          </h2>
          {data.last_traced_date && (
            <span className="text-[10px] text-on-surface-variant">
              {daysSinceTrace} days ago
            </span>
          )}
        </div>
        {needsRetrace && onRetrace && (
          <button
            onClick={onRetrace}
            className="px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold hover:opacity-90 transition-all flex items-center gap-2"
          >
            <Icon name="refresh" size="text-sm" />
            Re-Skip
          </button>
        )}
      </div>

      {/* Status Alert */}
      {needsRetrace && (
        <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
          <Icon name="schedule" className="text-amber-600 !text-sm shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wide mb-1">
              Data May Be Stale
            </p>
            <p className="text-xs text-amber-700">
              Skip trace is {daysSinceTrace}+ days old. Fresh data may reveal new contact numbers.
            </p>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      {data.phones.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-surface-container-low p-3 rounded-lg">
            <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Total Numbers</p>
            <p className="text-xl font-black text-primary">{data.phones.length}</p>
          </div>
          <div className="bg-green-50 p-3 rounded-lg border border-green-200">
            <p className="text-[10px] font-bold uppercase text-green-700 mb-1">Attempted</p>
            <p className="text-xl font-black text-green-600">{attemptedCount}</p>
          </div>
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <p className="text-[10px] font-bold uppercase text-blue-700 mb-1">Remaining</p>
            <p className="text-xl font-black text-blue-600">{unattemptedCount}</p>
          </div>
        </div>
      )}

      {/* Phone Numbers List */}
      {data.phones.length === 0 ? (
        <div className="text-center py-8">
          <Icon name="phone_disabled" className="!text-4xl text-on-surface-variant/30 mb-3" />
          <p className="text-sm font-bold text-on-surface-variant/60 mb-1">No Skip Trace Data</p>
          <p className="text-xs text-on-surface-variant/40">
            Run skip trace to find contact numbers for this lead.
          </p>
          {onRetrace && (
            <button
              onClick={onRetrace}
              className="mt-4 px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold hover:opacity-90 transition-all"
            >
              Run Skip Trace
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {data.phones.map((phone, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border ${
                phone.attempted
                  ? 'bg-surface-container border-outline-variant/20'
                  : 'bg-blue-50 border-blue-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Icon
                    name={phone.type === 'mobile' ? 'smartphone' : phone.type === 'voip' ? 'settings_phone' : 'phone'}
                    className={`!text-sm ${phone.attempted ? 'text-on-surface-variant' : 'text-blue-600'}`}
                  />
                  <span className={`font-mono text-sm font-bold ${phone.attempted ? 'text-on-surface' : 'text-blue-700'}`}>
                    {phone.number}
                  </span>
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                    phone.type === 'mobile'
                      ? 'bg-green-100 text-green-700'
                      : phone.type === 'voip'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {phone.type}
                  </span>
                </div>
                {phone.attempted ? (
                  <Icon name="check_circle" className="!text-sm text-green-600" />
                ) : (
                  <Icon name="radio_button_unchecked" className="!text-sm text-on-surface-variant/40" />
                )}
              </div>
              {phone.attempted && phone.last_disposition && (
                <div className="flex items-center gap-2 text-xs text-on-surface-variant mt-1">
                  <span className="font-semibold">{phone.last_disposition}</span>
                  {phone.last_attempt_date && (
                    <span className="text-on-surface-variant/60">
                      • {new Date(phone.last_attempt_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Last Traced Footer */}
      {data.last_traced_date && (
        <div className="mt-5 pt-4 border-t border-outline-variant/20">
          <p className="text-[10px] text-on-surface-variant">
            Last traced: {new Date(data.last_traced_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      )}
    </section>
  )
}
