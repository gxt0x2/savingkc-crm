'use client'

import { useMemo, useState } from 'react'

import {
  filterWholesaleZips,
  formatCount,
  formatDom,
  formatMoi,
  formatMoney,
  nextZipSort,
  sortWholesaleZips,
  type MoiBand,
  type WholesaleMarketSnapshot,
  type ZipSortColumn,
} from '@/lib/market-watch/snapshot'

import styles from './market-watch.module.css'
import { MarketWatchUpload } from './market-watch-upload'

const COLUMNS: Array<{ key: ZipSortColumn; label: string; numeric: boolean }> = [
  { key: 'rank', label: 'Rank', numeric: true },
  { key: 'zip', label: 'ZIP', numeric: false },
  { key: 'county', label: 'County', numeric: false },
  { key: 'solds', label: 'Solds', numeric: true },
  { key: 'median_close', label: 'Median close', numeric: true },
  { key: 'actives', label: 'Actives', numeric: true },
  { key: 'moi', label: 'MOI', numeric: true },
  { key: 'median_dom', label: 'Med. DOM', numeric: true },
]

const FLAG_CLASS: Record<string, string | undefined> = {
  Tight: styles.tight,
  Balanced: styles.balanced,
  Soft: styles.soft,
  'Near ceiling': styles.ceil,
  'Near floor': styles.floor,
  Fast: styles.fast,
}

export function MarketWatchView({ snapshots }: { snapshots: WholesaleMarketSnapshot[] }) {
  const [monthKey, setMonthKey] = useState(snapshots[0]?.meta.month_key ?? '')
  const [query, setQuery] = useState('')
  const [county, setCounty] = useState('')
  const [moiBand, setMoiBand] = useState<'' | MoiBand>('')
  const [primaryOnly, setPrimaryOnly] = useState(false)
  const [sort, setSort] = useState<{ column: ZipSortColumn; direction: 'asc' | 'desc' }>({ column: 'solds', direction: 'desc' })
  const selected = snapshots.find((snapshot) => snapshot.meta.month_key === monthKey) ?? snapshots[0]

  const counties = useMemo(
    () => selected ? [...new Set(selected.zips.map((zip) => zip.county))].sort((left, right) => left.localeCompare(right)) : [],
    [selected],
  )
  const rows = useMemo(() => {
    if (!selected) return []
    return sortWholesaleZips(filterWholesaleZips(selected.zips, { query, county, moiBand, primaryOnly }), sort.column, sort.direction)
  }, [selected, query, county, moiBand, primaryOnly, sort])

  if (!selected) {
    return <p className={styles.wrap}>No wholesale market snapshot is available.</p>
  }

  const maxMoi = Math.max(...selected.zips.map((zip) => zip.moi), 1)
  const monthName = selected.meta.month.replace(/\s+\d{4}$/, '')
  const kpis = [
    { label: 'Sold residential', value: formatCount(selected.summary.sold_records), note: `${monthName} closes` },
    { label: 'Active inventory', value: formatCount(selected.summary.active_records), note: 'as-of pull' },
    { label: 'Median close', value: formatMoney(selected.summary.sold_median_close), note: 'metro solds' },
    { label: 'Median DOM', value: formatDom(selected.summary.sold_median_dom), note: 'days' },
    { label: 'Wholesale-fit zips', value: formatCount(selected.summary.fit_zip_count), note: 'band + solds ≥ 20', accent: true },
    { label: 'Metro MOI', value: formatMoi(selected.summary.metro_moi), note: 'actives ÷ solds' },
  ]

  function chooseMonth(nextMonth: string) {
    setMonthKey(nextMonth)
    setQuery('')
    setCounty('')
    setMoiBand('')
    setPrimaryOnly(false)
    setSort({ column: 'solds', direction: 'desc' })
  }

  return (
    <div className={styles.root}>
      <div className={styles.wrap}>
        <header className={styles.hero}>
          <h1>{selected.meta.title}</h1>
          <p className={styles.sub}>{selected.meta.subtitle}</p>
          <div className={styles.metaRow}>
            <span className={styles.badge}>{selected.meta.source_badge}</span>
            <span>As-of: {selected.meta.as_of}</span>
            <label>
              <span className="sr-only">Month</span>
              <select className={styles.monthSelect} value={selected.meta.month_key} onChange={(event) => chooseMonth(event.target.value)} aria-label="Market month">
                {snapshots.map((snapshot) => <option key={snapshot.meta.month_key} value={snapshot.meta.month_key}>{snapshot.meta.month}</option>)}
              </select>
            </label>
          </div>
        </header>

        <section className={styles.section} aria-label="Metro snapshot">
          <h2>Metro snapshot <span className={styles.hint}>Matrix wholesale filter · five counties</span></h2>
          <div className={styles.kpis}>
            {kpis.map((kpi) => (
              <article key={kpi.label} className={kpi.accent ? `${styles.kpi} ${styles.kpiAccent}` : styles.kpi}>
                <p className={styles.kpiLabel}>{kpi.label}</p>
                <p className={styles.kpiValue}>{kpi.value}</p>
                <p className={styles.kpiNote}>{kpi.note}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-label="Analyst insights">
          <h2>Analyst insights <span className={styles.hint}>auto-computed from fit zips</span></h2>
          <div className={styles.chips}>
            {selected.insights.map((insight) => (
              <article key={insight.kind} className={styles.chip}>
                <p className={styles.kind}>{insight.kind}</p>
                <p className={styles.zipCode}>{insight.zip}</p>
                <p>{insight.metric}</p>
                <p className={styles.detail}>{insight.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-label="County rollup">
          <h2>County rollup <span className={styles.hint}>Matrix fit zips vs KCRAR retail county LMU</span></h2>
          <div className={styles.tableWrap}>
            <table>
              <caption className="sr-only">Heartland Matrix wholesale-fit zips beside {selected.kcrar_meta.label}. KCRAR figures are all-residential retail, not the wholesale band.</caption>
              <thead>
                <tr>
                  <th rowSpan={2} scope="col">County</th>
                  <th colSpan={5} className={styles.center} scope="colgroup">Heartland Matrix · wholesale-fit zips ($200k–$400k)</th>
                  <th colSpan={5} className={`${styles.center} ${styles.kcrar}`} scope="colgroup">{selected.kcrar_meta.label}</th>
                </tr>
                <tr>
                  <th className={styles.num} scope="col"># Fit</th>
                  <th className={styles.num} scope="col">Sum solds</th>
                  <th className={styles.num} scope="col">Sum actives</th>
                  <th className={styles.num} scope="col">Med. of medians<span className={styles.subhead}>simple</span></th>
                  <th className={styles.num} scope="col">Avg MOI</th>
                  <th className={`${styles.num} ${styles.kcrar}`} scope="col">Closed</th>
                  <th className={`${styles.num} ${styles.kcrar}`} scope="col">Median $</th>
                  <th className={`${styles.num} ${styles.kcrar}`} scope="col">DOM</th>
                  <th className={`${styles.num} ${styles.kcrar}`} scope="col">Supply</th>
                  <th className={`${styles.num} ${styles.kcrar}`} scope="col">Inventory</th>
                </tr>
              </thead>
              <tbody>
                {selected.counties.map((row) => (
                  <tr key={row.county}>
                    <th scope="row">{row.county}</th>
                    <td className={styles.num}>{formatCount(row.fit_zips)}</td>
                    <td className={styles.num}>{formatCount(row.sum_solds)}</td>
                    <td className={styles.num}>{formatCount(row.sum_actives)}</td>
                    <td className={styles.num}>{formatMoney(row.median_of_medians)}</td>
                    <td className={styles.num}>{formatMoi(row.avg_moi)}</td>
                    <td className={`${styles.num} ${styles.kcrar}`}>{formatCount(row.kcrar.closed_sales)}</td>
                    <td className={`${styles.num} ${styles.kcrar}`}>{formatMoney(row.kcrar.median_sales_price)}</td>
                    <td className={`${styles.num} ${styles.kcrar}`}>{formatDom(row.kcrar.dom)}</td>
                    <td className={`${styles.num} ${styles.kcrar}`}>{formatMoi(row.kcrar.supply_moi)}</td>
                    <td className={`${styles.num} ${styles.kcrar}`}>{formatCount(row.kcrar.inventory)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section} aria-label="Wholesale-fit ZIP table">
          <h2>Wholesale-fit ZIP table <span className={styles.hint}>{formatCount(selected.summary.fit_zip_count)} wholesale-fit zips · rank = solds desc, then MOI asc</span></h2>
          <div className={styles.controls}>
            <div className={styles.ctrl}>
              <label htmlFor="market-zip-search">Search ZIP</label>
              <input id="market-zip-search" type="search" value={query} placeholder="e.g. 64118" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className={styles.ctrl}>
              <label htmlFor="market-county">County</label>
              <select id="market-county" value={county} onChange={(event) => setCounty(event.target.value)}>
                <option value="">All</option>
                {counties.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div className={styles.ctrl}>
              <label htmlFor="market-moi">MOI band</label>
              <select id="market-moi" value={moiBand} onChange={(event) => setMoiBand(event.target.value as '' | MoiBand)}>
                <option value="">All</option>
                <option value="Tight">Tight (&lt; 1.5)</option>
                <option value="Balanced">Balanced (1.5–3)</option>
                <option value="Soft">Soft (≥ 3)</option>
              </select>
            </div>
            <label className={styles.toggle} title={selected.meta.primary_target_rule}>
              <input type="checkbox" checked={primaryOnly} onChange={(event) => setPrimaryOnly(event.target.checked)} />
              Primary targets only
            </label>
            <p className={styles.count} aria-live="polite">
              Showing {formatCount(rows.length)} of {formatCount(selected.zips.length)}
              {primaryOnly ? ` · primary rule: ${selected.meta.primary_target_rule}` : ''}
            </p>
          </div>
          <p className={styles.rule}>Primary targets = <strong>Tight</strong> OR (<strong>Balanced</strong> AND solds ≥ 35). Click column headers to sort.</p>
          <div className={styles.tableWrap}>
            <table>
              <caption className="sr-only">Wholesale-fit ZIP codes for {selected.meta.month}. These rows are analyst targets, not CRM leads.</caption>
              <thead>
                <tr>
                  {COLUMNS.map((column) => {
                    const active = sort.column === column.key
                    return (
                      <th key={column.key} className={column.numeric ? styles.num : undefined} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} scope="col">
                        <button type="button" className={active ? `${styles.sortButton} ${styles.active}` : styles.sortButton} onClick={() => setSort((current) => nextZipSort(current, column.key))}>
                          {column.label}<span className={styles.arrow} aria-hidden="true">{active && sort.direction === 'asc' ? '▴' : '▾'}</span>
                        </button>
                      </th>
                    )
                  })}
                  <th scope="col">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9}>No zips match these filters.</td></tr>
                ) : rows.map((zip) => (
                  <tr key={zip.zip}>
                    <td className={styles.num}>{formatCount(zip.rank)}</td>
                    <td>{zip.primary_target ? <span className={styles.primaryDot} title="Primary target" /> : null}<strong>{zip.zip}</strong></td>
                    <td>{zip.county}</td>
                    <td className={styles.num}>{formatCount(zip.solds)}</td>
                    <td className={styles.num}>{formatMoney(zip.median_close)}</td>
                    <td className={styles.num}>{formatCount(zip.actives)}</td>
                    <td className={styles.num}><span className={styles.moiBar} style={{ width: `${Math.max(2, Math.round((zip.moi / maxMoi) * 48))}px` }} />{formatMoi(zip.moi)}</td>
                    <td className={styles.num}>{formatDom(zip.median_dom)}</td>
                    <td className={styles.flags}>{zip.flags.map((flag) => <span key={flag} className={`${styles.flag} ${FLAG_CLASS[flag] ?? ''}`}>{flag}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${styles.section} ${styles.method}`}>
          <h2>Methodology</h2>
          <ul>
            {selected.meta.methodology.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div className={styles.gaps}>
            <strong>Data gaps</strong>
            <ul>
              {selected.meta.data_gaps.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <MarketWatchUpload onUploaded={chooseMonth} />
        </section>

        <p className={styles.footer}>
          Saving KC Homebuyers · generated {selected.meta.generated_at} · Matrix month {selected.meta.month} · not for CRM dump · KCRAR retail context labeled separately
        </p>
      </div>
    </div>
  )
}
