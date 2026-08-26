// DOC-01: Contract / Document Status Section
// Night 4 Phase 1: Property Dossier

import { Icon } from '@/components/ui/icon'

export interface ContractStatusData {
  status: 'none' | 'sent' | 'viewed' | 'signed' | 'expired'
  sent_date?: string
  viewed_date?: string
  signed_date?: string
  expired_date?: string
  offer_amount?: number
  contract_url?: string
  signer_name?: string
}

interface ContractStatusProps {
  data: ContractStatusData
  onSendContract?: () => void
}

const TIMELINE_STEPS = [
  { key: 'sent', label: 'Sent', icon: 'send' },
  { key: 'viewed', label: 'Viewed', icon: 'visibility' },
  { key: 'signed', label: 'Signed', icon: 'check_circle' },
] as const

function getStepStatus(
  currentStatus: ContractStatusData['status'],
  stepKey: typeof TIMELINE_STEPS[number]['key']
): 'completed' | 'current' | 'pending' {
  const statusOrder = ['none', 'sent', 'viewed', 'signed', 'expired']
  const currentIndex = statusOrder.indexOf(currentStatus)
  const stepIndex = statusOrder.indexOf(stepKey)

  if (currentIndex > stepIndex) return 'completed'
  if (currentIndex === stepIndex) return 'current'
  return 'pending'
}

function getHoursSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60))
}

export function ContractStatus({ data, onSendContract }: ContractStatusProps) {
  const hoursSinceViewed = getHoursSince(data.viewed_date)
  const isViewedButNotSigned = data.status === 'viewed' && hoursSinceViewed !== null

  // Escalation levels based on Ari Doctrine 9
  const isHighPriority = isViewedButNotSigned && hoursSinceViewed >= 24
  const isCritical = isViewedButNotSigned && hoursSinceViewed >= 48

  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-black uppercase tracking-widest text-primary">
          Contract Status
        </h2>
        {data.offer_amount && (
          <span className="text-xs font-bold text-secondary">
            Offer: ${data.offer_amount.toLocaleString()}
          </span>
        )}
      </div>

      {/* Escalation Alerts - Doctrine 9 */}
      {isCritical && (
        <div className="mb-5 p-3 bg-red-50 border-2 border-red-300 rounded-lg flex items-start gap-2">
          <Icon name="error" className="text-red-600 !text-base shrink-0 mt-0.5 animate-pulse" />
          <div>
            <p className="text-[11px] font-black text-red-800 uppercase tracking-wide mb-1">
              🚨 CRITICAL: Contract Viewed 48+ Hours Ago
            </p>
            <p className="text-xs text-red-700">
              Seller opened the contract {hoursSinceViewed} hours ago but hasn&apos;t signed. Immediate follow-up required.
            </p>
          </div>
        </div>
      )}

      {isHighPriority && !isCritical && (
        <div className="mb-5 p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2">
          <Icon name="warning" className="text-amber-600 !text-sm shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wide mb-1">
              Contract Viewed But Not Signed
            </p>
            <p className="text-xs text-amber-700">
              Seller viewed the contract {hoursSinceViewed} hours ago. Follow up to address any concerns.
            </p>
          </div>
        </div>
      )}

      {data.status === 'expired' && (
        <div className="mb-5 p-3 bg-slate-100 border border-slate-300 rounded-lg flex items-start gap-2">
          <Icon name="schedule" className="text-slate-600 !text-sm shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-slate-800 uppercase tracking-wide mb-1">
              Contract Expired
            </p>
            <p className="text-xs text-slate-700">
              This contract expired on {data.expired_date && new Date(data.expired_date).toLocaleDateString()}. Send a new offer if still interested.
            </p>
          </div>
        </div>
      )}

      {/* Timeline */}
      {data.status !== 'none' ? (
        <div className="space-y-4">
          {TIMELINE_STEPS.map((step, idx) => {
            const status = getStepStatus(data.status, step.key)
            const dateKey = `${step.key}_date` as keyof ContractStatusData
            const stepDate = data[dateKey] as string | undefined

            return (
              <div key={step.key} className="flex items-start gap-4">
                {/* Icon */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  status === 'completed'
                    ? 'bg-green-100 border-2 border-green-500'
                    : status === 'current'
                    ? 'bg-primary border-2 border-primary'
                    : 'bg-surface-container border-2 border-outline-variant/30'
                }`}>
                  <Icon
                    name={status === 'completed' ? 'check_circle' : step.icon}
                    className={`!text-lg ${
                      status === 'completed'
                        ? 'text-green-600'
                        : status === 'current'
                        ? 'text-white'
                        : 'text-on-surface-variant/40'
                    }`}
                  />
                </div>

                {/* Content */}
                <div className="flex-1 pt-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-sm font-bold ${
                      status === 'pending' ? 'text-on-surface-variant/60' : 'text-primary'
                    }`}>
                      {step.label}
                    </p>
                    {stepDate && (
                      <span className="text-[10px] text-on-surface-variant">
                        {new Date(stepDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>

                  {step.key === 'sent' && data.signer_name && status !== 'pending' && (
                    <p className="text-xs text-on-surface-variant">
                      Sent to {data.signer_name}
                    </p>
                  )}

                  {step.key === 'signed' && status === 'completed' && (
                    <p className="text-xs text-green-700 font-semibold">
                      ✓ Contract executed
                    </p>
                  )}
                </div>

                {/* Connector Line */}
                {idx < TIMELINE_STEPS.length - 1 && (
                  <div className="absolute left-[44px] w-0.5 h-8 bg-outline-variant/30 mt-10" />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-8">
          <Icon name="description" className="!text-4xl text-on-surface-variant/30 mb-3" />
          <p className="text-sm font-bold text-on-surface-variant/60 mb-1">No Contract Sent</p>
          <p className="text-xs text-on-surface-variant/40 mb-4">
            Ready to send an offer? Generate and send the contract.
          </p>
          {onSendContract && (
            <button
              onClick={onSendContract}
              className="px-6 py-2.5 bg-secondary text-white rounded-lg text-sm font-bold hover:opacity-90 transition-all flex items-center gap-2 mx-auto"
            >
              <Icon name="bolt" size="text-sm" />
              Generate Contract
            </button>
          )}
        </div>
      )}

      {/* Contract Link */}
      {data.contract_url && data.status !== 'none' && (
        <div className="mt-5 pt-4 border-t border-outline-variant/20">
          <a
            href={data.contract_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Icon name="open_in_new" className="!text-xs" />
            View contract in DocuSeal
          </a>
        </div>
      )}
    </section>
  )
}
