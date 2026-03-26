import type { PersonalityType } from '@/types'

interface AriBriefingProps {
  personalityType: PersonalityType
  tacticalApproach: string
}

export function AriBriefing({ personalityType, tacticalApproach }: AriBriefingProps) {
  return (
    <section className="bg-primary-container text-on-primary rounded-xl p-6 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-secondary opacity-5 blur-[80px]" />

      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-secondary-fixed shadow-[0_0_8px_2px_rgba(107,255,143,0.4)]" />
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-primary-container">
          Ari AI Briefing
        </h2>
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-[10px] text-on-primary-container font-bold uppercase mb-1">
            Personality Type
          </p>
          <span className="px-3 py-1 bg-on-primary-fixed-variant rounded-full text-xs font-bold text-white capitalize">
            {personalityType}
          </span>
        </div>

        <div>
          <p className="text-[10px] text-on-primary-container font-bold uppercase mb-1">
            Tactical Approach
          </p>
          <p className="text-sm leading-relaxed text-surface-variant">
            {tacticalApproach}
          </p>
        </div>
      </div>
    </section>
  )
}
