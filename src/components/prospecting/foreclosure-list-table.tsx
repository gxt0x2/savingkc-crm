'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ForeclosureStatusPill } from '@/components/prospecting/foreclosure-mobile'
import { Icon } from '@/components/ui/icon'
import {
  foreclosureCountyState,
  foreclosureListHasPhone,
  foreclosureListPhone,
  foreclosureMoney,
  foreclosureNoticeBadge,
  foreclosureOwnerLabel,
  foreclosureSalePresentation,
  foreclosureStreetLine,
  sortForeclosureList,
  type ForeclosureListSortDirection,
  type ForeclosureListSortKey,
} from '@/lib/prospecting/foreclosure-list'
import {
  chicagoDate,
  type ForeclosureNoticeType,
  type ForeclosureStatus,
} from '@/lib/prospecting/foreclosure'

export interface ForeclosureTableRow {
  id: string
  ownerName: string | null
  situs: string | null
  city: string | null
  state: string
  county: string
  zip?: string | null
  saleDate: string | null
  status: ForeclosureStatus
  estEquity: number | null
  estDebt?: number | null
  noticeType?: ForeclosureNoticeType | null
  phones: string[]
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string
  sortKey: ForeclosureListSortKey
  activeKey: ForeclosureListSortKey | null
  direction: ForeclosureListSortDirection
  onSort: (key: ForeclosureListSortKey) => void
}) {
  const active = activeKey === sortKey
  return (
    <th scope="col" aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="fc-sort" aria-label={`Sort by ${label.toLowerCase()}`} onClick={() => onSort(sortKey)}>
        {label}
        <Icon name={active ? 'arrow_upward' : 'swap_vert'} className={active && direction === 'desc' ? 'fc-glyph fc-sort-desc' : 'fc-glyph'} />
      </button>
    </th>
  )
}

export function ForeclosureListTable({
  prospects,
  busy,
  onCall,
}: {
  prospects: ForeclosureTableRow[]
  busy: boolean
  onCall: (id: string) => void
}) {
  const router = useRouter()
  const today = chicagoDate()
  const [sort, setSort] = useState<{ key: ForeclosureListSortKey; direction: ForeclosureListSortDirection } | null>(null)
  const rows = useMemo(
    () => (sort ? sortForeclosureList(prospects, sort.key, sort.direction) : prospects),
    [prospects, sort],
  )

  function toggleSort(key: ForeclosureListSortKey) {
    setSort((current) => {
      if (!current || current.key !== key) {
        return { key, direction: key === 'equity' ? 'desc' : 'asc' }
      }
      return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    })
  }

  return (
    <div className="fc-table-wrap">
      <table className="fc-table" aria-label="Foreclosure prospects">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Owner</th>
            <th scope="col">Street</th>
            <th scope="col">County · ST</th>
            <SortHeader label="Sale date" sortKey="sale" activeKey={sort?.key ?? null} direction={sort?.direction ?? 'asc'} onSort={toggleSort} />
            <SortHeader label="Equity" sortKey="equity" activeKey={sort?.key ?? null} direction={sort?.direction ?? 'desc'} onSort={toggleSort} />
            <th scope="col" className="fc-num">Debt</th>
            <th scope="col">Notice</th>
            <th scope="col">Phone</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((prospect) => {
            const href = `/prospecting/foreclosure/${prospect.id}`
            const owner = foreclosureOwnerLabel(prospect.ownerName)
            const street = foreclosureStreetLine(prospect.situs, prospect)
            const sale = foreclosureSalePresentation(prospect.saleDate, today)
            const notice = foreclosureNoticeBadge(prospect.noticeType)
            const phone = foreclosureListPhone(prospect.phones)
            const hasPhone = foreclosureListHasPhone(prospect.phones)
            return (
              <tr
                key={prospect.id}
                className="fc-row"
                onClick={(event) => {
                  const target = event.target
                  if (target instanceof Element && target.closest('a, button')) return
                  router.push(href)
                }}
              >
                <td><ForeclosureStatusPill status={prospect.status} /></td>
                <td className="fc-clip" title={owner === '—' ? undefined : owner}>
                  <Link href={href} className="fc-owner-link" aria-label={owner === '—' ? 'Open prospect' : undefined}>{owner}</Link>
                </td>
                <td className="fc-clip fc-street" title={street === '—' ? undefined : street}>{street}</td>
                <td><span className="fc-chip">{foreclosureCountyState(prospect.county, prospect.state)}</span></td>
                <td>
                  <span className={sale.tone === 'none' ? 'fc-sale' : `fc-sale fc-sale-${sale.tone}`}>
                    {sale.label}
                    {sale.days != null ? <span className="fc-sale-days">{sale.days}d</span> : null}
                  </span>
                </td>
                <td className="fc-num">{foreclosureMoney(prospect.estEquity)}</td>
                <td className="fc-num">{foreclosureMoney(prospect.estDebt ?? null)}</td>
                <td>{notice ? <span className="fc-type" title={prospect.noticeType ?? undefined}>{notice}</span> : '—'}</td>
                <td className="fc-phone-cell">{phone}</td>
                <td>
                  <div className="fc-actions">
                    <Link href={href} className="fc-view" onClick={(event) => event.stopPropagation()}>
                      <Icon name="visibility" className="fc-glyph" />
                      View
                    </Link>
                    {hasPhone ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCall(prospect.id)
                        }}
                        className="fc-call"
                      >
                        <Icon name="call" className="fc-glyph" />
                        Call
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
