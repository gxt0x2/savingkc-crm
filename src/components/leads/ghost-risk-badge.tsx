'use client'

interface GhostRiskBadgeProps {
  ghostRiskScore: number
  ghostProtocolActive?: boolean
}

export function GhostRiskBadge({ ghostRiskScore, ghostProtocolActive }: GhostRiskBadgeProps) {
  if (ghostRiskScore === undefined && !ghostProtocolActive) return null

  const score = ghostRiskScore || 0

  if (ghostProtocolActive) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
        Ghost Risk
      </span>
    )
  }

  if (score >= 50) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
        {score}
      </span>
    )
  }

  if (score >= 31) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        {score}
      </span>
    )
  }

  if (score > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
        {score}
      </span>
    )
  }

  return null
}
