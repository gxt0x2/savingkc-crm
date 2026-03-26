import { Icon } from '@/components/ui/icon'

export function AriInsight({
  insight,
  tags,
}: {
  insight: string | null
  tags?: string[]
}) {
  if (!insight) return null

  return (
    <div className="border-l-4 border-secondary bg-green-50/50 p-4 rounded-r-xl">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 bg-secondary rounded-full shadow-[0_0_8px_#006e2f] animate-pulse" />
        <span className="text-[10px] font-black uppercase tracking-widest text-secondary">Ari Insight</span>
      </div>
      <p className="text-sm text-on-surface-variant leading-relaxed">{insight}</p>
      {tags && tags.length > 0 && (
        <div className="flex gap-2 mt-3">
          {tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-secondary/10 text-secondary text-[10px] font-bold rounded uppercase"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
