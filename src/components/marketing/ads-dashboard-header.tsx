import Link from 'next/link'
import { Icon } from '@/components/ui/icon'

type AdsDashboardHeaderProps = {
  syncedLabel: string
  googleAdsFreshness: string
  crmFreshness: string
}

export function AdsDashboardHeader({ syncedLabel, googleAdsFreshness, crmFreshness }: AdsDashboardHeaderProps) {
  return (
    <>
      <header className="ads-dashboard-header">
        <div className="ads-dashboard-heading">
          <span>Team dashboard · Marketing</span>
          <h1>Google Ads performance</h1>
          <p>Live Google Search spend, demand, seller attribution, call outcomes, and offline conversion health.</p>
        </div>
        <div className="ads-dashboard-actions">
          <span className="ads-sync-pill"><span className="live-dot" /> {syncedLabel}</span>
          <Link className="ads-header-action" href="/reports/marketing" aria-label="CRM attribution report">
            <Icon name="analytics" className="text-[17px]" />
            CRM attribution
          </Link>
          <Link className="ads-header-action" href="/marketing/calls?source=google_ads">
            <Icon name="record_voice_over" className="text-[17px]" />
            Call review
          </Link>
          <Link className="ads-header-action" href="/marketing/alerts?source=google_ads">
            <Icon name="notification_important" className="text-[17px]" />
            Lead alerts
          </Link>
        </div>
      </header>
      <section className="ads-freshness-strip" aria-label="Google Ads data freshness">
        <div><Icon name="ads_click" className="text-[18px]" /><span>Google Ads import</span><strong>{googleAdsFreshness}</strong></div>
        <div><Icon name="conversion_path" className="text-[18px]" /><span>CRM tracking</span><strong>{crmFreshness}</strong></div>
        <Link href="/marketing/heatmaps?source=google_ads">
          <Icon name="web_traffic" className="text-[18px]" />
          Landing-page diagnostics
          <Icon name="arrow_forward" className="text-[16px]" />
        </Link>
      </section>
      <style>{ADS_DASHBOARD_HEADER_STYLES}</style>
    </>
  )
}

const ADS_DASHBOARD_HEADER_STYLES = `
.ads-command .ads-dashboard-header { display:flex; align-items:center; justify-content:space-between; gap:18px; flex-wrap:wrap; border:1px solid var(--line); border-radius:16px; background:var(--surface); padding:16px 20px; box-shadow:var(--shadow-sm); }
.ads-command .ads-dashboard-heading { min-width:280px; flex:1 1 520px; }
.ads-command .ads-dashboard-heading > span { display:block; margin-bottom:4px; color:var(--accent); font-size:10px; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
.ads-command .ads-dashboard-heading h1 { margin:0; color:var(--text); font-size:25px; font-weight:900; line-height:1.05; letter-spacing:-.035em; }
.ads-command .ads-dashboard-heading p { max-width:760px; margin:5px 0 0; color:var(--text-secondary); font-size:12px; font-weight:600; line-height:1.4; }
.ads-command .ads-dashboard-actions { display:flex; flex:0 1 auto; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
.ads-command .ads-sync-pill, .ads-command .ads-header-action { min-height:38px; display:inline-flex; align-items:center; justify-content:center; gap:7px; border:1px solid var(--line); border-radius:11px; padding:0 12px; font-size:11px; font-weight:850; text-decoration:none; white-space:nowrap; }
.ads-command .ads-sync-pill { color:var(--success); border-color:var(--crm-success-border); background:var(--success-soft); }
.ads-command .ads-header-action { color:var(--text); background:var(--surface); transition:background .12s ease,border-color .12s ease,color .12s ease; }
.ads-command .ads-header-action:hover { color:var(--accent); border-color:var(--crm-brand-border); background:var(--crm-brand-soft); }
.ads-command .ads-freshness-strip { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)) minmax(240px,auto); gap:8px; margin:10px 0 14px; }
.ads-command .ads-freshness-strip > div, .ads-command .ads-freshness-strip > a { min-width:0; min-height:42px; display:flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:11px; background:var(--surface); padding:0 12px; color:var(--text-secondary); font-size:10px; font-weight:800; text-decoration:none; }
.ads-command .ads-freshness-strip > div > span { color:var(--text-tertiary); text-transform:uppercase; letter-spacing:.055em; }
.ads-command .ads-freshness-strip > div > strong { margin-left:auto; color:var(--text); font-size:11px; }
.ads-command .ads-freshness-strip > a { justify-content:center; color:var(--info); }
.ads-command .ads-freshness-strip > a:hover { border-color:var(--crm-info-border); background:var(--info-soft); }
@media (max-width:720px) { .ads-command .ads-dashboard-header { align-items:flex-start; padding:15px; } .ads-command .ads-dashboard-actions { justify-content:flex-start; } .ads-command .ads-freshness-strip { grid-template-columns:1fr; } }
`
