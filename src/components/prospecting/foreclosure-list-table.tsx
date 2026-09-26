'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ForeclosureStatusPill } from '@/components/prospecting/foreclosure-mobile'
import {
  foreclosureCountyState,
  foreclosureListPhone,
  foreclosureMoney,
  foreclosureOwnerLines,
  foreclosureSalePresentation,
  foreclosureStreetParts,
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
        <span aria-hidden="true" className="fc-sort-mark">{active ? (direction === 'asc' ? '▴' : '▾') : '▾'}</span>
      </button>
    </th>
  )
}

export function ForeclosureListTable({
  prospects,
}: {
  prospects: ForeclosureTableRow[]
}) {
  const router = useRouter()
  const today = chicagoDate()
  const [sort, setSort] = useState<{ key: ForeclosureListSortKey; direction: ForeclosureListSortDirection } | null>(null)
  const [page, setPage] = useState(0)
  const rows = useMemo(
    () => (sort ? sortForeclosureList(prospects, sort.key, sort.direction) : prospects),
    [prospects, sort],
  )
  const pageCount = Math.max(1, Math.ceil(rows.length / 15))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(currentPage * 15, currentPage * 15 + 15)
  const rangeStart = rows.length === 0 ? 0 : currentPage * 15 + 1
  const rangeEnd = Math.min(rows.length, currentPage * 15 + 15)

  function toggleSort(key: ForeclosureListSortKey) {
    setSort((current) => {
      if (!current || current.key !== key) {
        return { key, direction: key === 'equity' ? 'desc' : 'asc' }
      }
      return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    })
  }

  return (
    <div className="fc-queue">
    <div className="fc-table-wrap">
      <table className="fc-table" aria-label="Foreclosure prospects">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <SortHeader label="Owner" sortKey="owner" activeKey={sort?.key ?? null} direction={sort?.direction ?? 'asc'} onSort={toggleSort} />
            <th scope="col">Street</th>
            <th scope="col">County · ST</th>
            <SortHeader label="Sale date" sortKey="sale" activeKey={sort?.key ?? null} direction={sort?.direction ?? 'asc'} onSort={toggleSort} />
            <SortHeader label="Days" sortKey="days" activeKey={sort?.key ?? null} direction={sort?.direction ?? 'asc'} onSort={toggleSort} />
            <SortHeader label="Equity" sortKey="equity" activeKey={sort?.key ?? null} direction={sort?.direction ?? 'desc'} onSort={toggleSort} />
            <th scope="col" className="fc-num">Debt</th>
            <th scope="col">Phone</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((prospect) => {
            const href = `/prospecting/foreclosure/${prospect.id}`
            const owners = foreclosureOwnerLines(prospect.ownerName)
            const street = foreclosureStreetParts(prospect.situs, prospect)
            const sale = foreclosureSalePresentation(prospect.saleDate, today)
            const phone = foreclosureListPhone(prospect.phones)
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
                <td className="fc-owner-cell" title={owners.length === 0 ? undefined : owners.join(', ')}>
                  <Link href={href} className="fc-owner-link fc-owners" aria-label={owners.length === 0 ? 'Open prospect' : undefined}>
                    {owners.length === 0 ? '—' : owners.map((line) => <span key={line} className="fc-owner-line">{line}</span>)}
                  </Link>
                </td>
                <td className="fc-street" title={street.unit ? `${street.street} ${street.unit}` : street.street}>
                  <span className="fc-street-line">{street.street}</span>
                  {street.unit ? <span className="fc-street-unit">{street.unit}</span> : null}
                </td>
                <td><span className="fc-county">{foreclosureCountyState(prospect.county, prospect.state)}</span></td>
                <td>
                  <span className={sale.tone === 'none' ? 'fc-sale' : `fc-sale fc-sale-${sale.tone}`}>{sale.label}</span>
                </td>
                <td className={sale.days == null ? 'fc-num' : `fc-num fc-days fc-days-${sale.tone}`}>{sale.days == null ? '—' : sale.days}</td>
                <td className="fc-num">{foreclosureMoney(prospect.estEquity)}</td>
                <td className="fc-num">{foreclosureMoney(prospect.estDebt ?? null)}</td>
                <td className="fc-phone-cell">{phone}</td>
                <td>
                  <div className="fc-actions">
                    <Link href={href} className="fc-view" onClick={(event) => event.stopPropagation()}>
                      <svg viewBox="0 0 24 24" className="fc-eye" aria-hidden="true"><path fill="currentColor" d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 2.2a4.8 4.8 0 1 0 .1 9.6 4.8 4.8 0 0 0-.1-9.6zm0 2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z" /></svg>
                      View
                    </Link>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    <div className="fc-pager">
      <p>Showing {rangeStart}–{rangeEnd} of {rows.length}</p>
      <div className="fc-pager-controls" role="navigation" aria-label="Pages">
        <button type="button" aria-label="First page" disabled={currentPage === 0} onClick={() => setPage(0)}>«</button>
        <button type="button" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button>
        {Array.from({ length: pageCount }, (_, index) => (
          <button key={index} type="button" aria-label={`Page ${index + 1}`} aria-current={index === currentPage ? 'page' : undefined} onClick={() => setPage(index)}>{index + 1}</button>
        ))}
        <button type="button" aria-label="Next page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>›</button>
        <button type="button" aria-label="Last page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>»</button>
      </div>
    </div>
    </div>
  )
}
