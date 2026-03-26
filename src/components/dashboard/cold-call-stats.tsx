'use client'

interface StatCardProps {
  label: string
  value: string
  suffix?: string
  suffixColor?: string
  progressPercent: number
  progressColor: string
}

function StatCard({ label, value, suffix, suffixColor = 'text-slate-400', progressPercent, progressColor }: StatCardProps) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
      <div className="flex justify-between items-end mb-4">
        <div>
          <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{label}</span>
          <h3 className="text-2xl font-black text-primary mt-1">{value}</h3>
        </div>
        {suffix && (
          <span className={`text-[10px] font-bold ${suffixColor} mb-1`}>{suffix}</span>
        )}
      </div>
      <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
        <div className={`${progressColor} h-full`} style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  )
}

export function ColdCallStats() {
  return (
    <div className="space-y-6">
      <h4 className="text-xs font-black text-primary uppercase tracking-[0.2em]">Cold Call Performance</h4>
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Dial Time</span>
                <h3 className="text-2xl font-black text-primary mt-1">2.4 mins</h3>
              </div>
              <span className="text-[10px] font-bold text-error">-12%</span>
            </div>
            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
              <div className="bg-error h-full w-[60%]" />
            </div>
          </div>
          <StatCard
            label="Calls"
            value="1,500"
            suffix="/ agent"
            progressPercent={80}
            progressColor="bg-blue-500"
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="Contacts"
            value="150"
            suffix="10.0%"
            suffixColor="text-secondary"
            progressPercent={40}
            progressColor="bg-emerald-500"
          />
          <StatCard
            label="Leads Generated"
            value="15"
            suffix="1.0%"
            suffixColor="text-amber-500"
            progressPercent={30}
            progressColor="bg-amber-500"
          />
          <StatCard
            label="Appts Set"
            value="4"
            suffix="26% conv."
            suffixColor="text-purple-600"
            progressPercent={50}
            progressColor="bg-purple-600"
          />
        </div>
      </div>
    </div>
  )
}
