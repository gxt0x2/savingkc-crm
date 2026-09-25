import {
  STATUS_LABELS,
  type ForeclosureStatus,
} from '@/lib/prospecting/foreclosure'

export function ForeclosureStatusPill({ status }: { status: ForeclosureStatus }) {
  return <span className={`fc-pill fc-pill-${status}`}>{STATUS_LABELS[status]}</span>
}

export function ForeclosureKpis({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="fc-kpis">
      {items.map((item) => (
        <div key={item.label} className="fc-kpi">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
