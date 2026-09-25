import {
  STATUS_LABELS,
  type ForeclosureStatus,
} from '@/lib/prospecting/foreclosure'

export function ForeclosureStatusPill({ status }: { status: ForeclosureStatus }) {
  return <span className={`fc-pill fc-pill-${status}`}>{STATUS_LABELS[status]}</span>
}

export function ForeclosureKpis({ items }: { items: Array<{ label: string; value: string; tone?: string }> }) {
  return (
    <dl className="fc-kpis">
      {items.map((item) => {
        const tone = item.tone && item.tone !== 'none' ? item.tone : ''
        return (
          <div key={item.label} className={tone ? `fc-kpi fc-kpi-${tone}` : 'fc-kpi'}>
            <dt>{item.label}</dt>
            <dd className={tone ? `fc-days-${tone}` : undefined}>{item.value}</dd>
          </div>
        )
      })}
    </dl>
  )
}
