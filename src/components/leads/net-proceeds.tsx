'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface NetProceedsProps {
  arv: number
  asIsValue: number
  askingPrice: number
  totalDebt: number
  equitySurplus: number
  estAssignment: number
  leadId?: string
}

function formatMoney(amount: number): string {
  return `$${Math.abs(amount).toLocaleString()}`
}

function parseMoney(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

export function NetProceeds({
  arv: initialArv,
  asIsValue: initialAsIs,
  askingPrice: initialAsking,
  totalDebt: initialDebt,
  leadId,
}: NetProceedsProps) {
  const [arv, setArv] = useState(initialArv)
  const [askingPrice, setAskingPrice] = useState(initialAsking)
  const [totalDebt, setTotalDebt] = useState(initialDebt)
  const [assignmentFee, setAssignmentFee] = useState(10000)

  const equity = arv - totalDebt
  const sellerNet = askingPrice - totalDebt
  const isViable = equity > 0 && sellerNet >= 0

  function NumInput({ label, value, onChange, hint }: {
    label: string
    value: number
    onChange: (n: number) => void
    hint?: string
  }) {
    return (
      <div>
        <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
          {label}
        </label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant text-xs">$</span>
          <input
            type="text"
            value={value === 0 ? '' : value.toLocaleString()}
            onChange={(e) => onChange(parseMoney(e.target.value))}
            placeholder="0"
            className="w-full pl-5 pr-2 py-1.5 text-sm font-semibold border border-outline-variant/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 bg-surface-container-low"
          />
        </div>
        {hint && <p className="text-[9px] text-on-surface-variant mt-0.5">{hint}</p>}
      </div>
    )
  }

  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
          Net Proceeds
        </h2>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
          arv === 0 ? 'bg-slate-100 text-slate-400' :
          isViable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          {arv === 0 ? 'Enter ARV' : isViable ? '✓ Viable' : '✗ No Deal'}
        </span>
      </div>

      {/* Inputs */}
      <div className="space-y-3 mb-5">
        <NumInput label="After Repair Value (ARV)" value={arv} onChange={setArv} />
        <NumInput label="Asking / Offer Price" value={askingPrice} onChange={setAskingPrice} />
        <NumInput label="Total Debt (Mortgage + Liens + Taxes)" value={totalDebt} onChange={setTotalDebt} />
        <NumInput label="Assignment Fee Target" value={assignmentFee} onChange={setAssignmentFee} />
      </div>

      {/* Results */}
      {arv > 0 && (
        <div className="border-t border-outline-variant/10 pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-on-surface-variant">Equity (ARV - Debt)</span>
            <span className={`font-black ${equity >= 0 ? 'text-primary' : 'text-error'}`}>{formatMoney(equity)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-on-surface-variant">Seller Net (Offer - Debt)</span>
            <span className={`font-bold ${sellerNet >= 0 ? 'text-secondary' : 'text-error'}`}>
              {sellerNet >= 0 ? formatMoney(sellerNet) : `-${formatMoney(sellerNet)}`}
            </span>
          </div>
        </div>
      )}

      <div className={`mt-5 -mx-6 -mb-6 p-6 ${isViable && arv > 0 ? 'bg-secondary/5' : 'bg-surface-container-high/30'}`}>
        <p className="text-[10px] font-black uppercase tracking-widest text-secondary mb-1">
          {isViable && arv > 0 ? 'Est. Assignment Fee' : 'Assignment Target'}
        </p>
        <p className={`text-3xl font-black leading-none ${isViable && arv > 0 ? 'text-secondary' : 'text-on-surface-variant/40'}`}>
          {formatMoney(assignmentFee)}
        </p>
      </div>
    </section>
  )
}
