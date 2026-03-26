interface NetProceedsProps {
  arv: number
  asIsValue: number
  askingPrice: number
  totalDebt: number
  equitySurplus: number
  estAssignment: number
}

function formatMoney(amount: number): string {
  return `$${Math.abs(amount).toLocaleString()}`
}

export function NetProceeds({
  arv,
  asIsValue,
  askingPrice,
  totalDebt,
  equitySurplus,
  estAssignment,
}: NetProceedsProps) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm overflow-hidden">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-6">
        Net Proceeds Calculator
      </h2>

      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-xs text-on-surface-variant">After Repair Value (ARV)</span>
          <span className="text-sm font-bold text-primary">{formatMoney(arv)}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs text-on-surface-variant">As-Is Valuation</span>
          <span className="text-sm font-bold text-primary">{formatMoney(asIsValue)}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs text-on-surface-variant">Asking Price</span>
          <span className="text-sm font-bold text-secondary">{formatMoney(askingPrice)}</span>
        </div>

        <div className="pt-4 border-t border-outline-variant/10 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-error font-medium">Total Debt</span>
            <span className="text-sm font-bold text-error">({formatMoney(totalDebt)})</span>
          </div>
          <p className="text-[9px] text-on-surface-variant text-right italic leading-none opacity-60">
            Mtg, Liens, Taxes
          </p>
        </div>

        <div className="flex justify-between items-center pt-2">
          <span className="text-xs font-bold text-primary">Equity Surplus</span>
          <span className="text-sm font-black text-secondary">{formatMoney(equitySurplus)}</span>
        </div>
      </div>

      <div className="mt-8 bg-secondary/5 -mx-6 -mb-6 p-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-secondary mb-1">
          Estimated Assignment
        </p>
        <p className="text-3xl font-black text-secondary leading-none">
          {formatMoney(estAssignment)}
        </p>
      </div>
    </section>
  )
}
