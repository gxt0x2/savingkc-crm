# Jackson and Johnson filings coverage

This pass adds court and lien lanes inside the existing Prospecting page at `/prospecting/foreclosure`. The visible name of that area is Filings. The route is unchanged. Divorces and liens are tabs on that page and are not written into `mortgage_foreclosure_prospects` or the foreclosure dial queue.

Probate is not a new pipeline. It stays on the existing deceased inheritance audience (`prospects.is_deceased`).

Commercial use of Jackson County government sites (collector, recorder, and county public search) is authorized. That permission does not cover Case.net, any Missouri Courts site, or Kansas Case Search. Case.net was requested again on 2026-10-04 and still returned HTTP 403 with title Error 403. The body says access by a site data scraper, or similar software that collects data through automated repetitive querying, is expressly prohibited. That block was not bypassed. No divorce or lis pendens rows were invented. Kansas Case Search was not contacted again.

The Jackson recorder public real-estate index does open without a county account. Federal tax liens are document type FEDERAL TAX LIEN. HOA liens are document type LIEN when the other party is a homeowners or homes association. Both are read for the last 14 Chicago days and shown on the Liens tab. `dialer_enrolled` stays false. If the recorder instead returns the page titled Browser Test - Jackson County Public Access Search, or a LoginForm1 logon wall, the fetch stops and names that page. None of these pulls is on a cron. PropStream is not a source. No skip trace runs here. The $75,000 mortgage equity floor is unchanged.

| County | Lead type | Status | Reason |
| --- | --- | --- | --- |
| Jackson MO | Divorce | cannot | Case.net returned HTTP 403 with title Error 403. Automated scraping is expressly prohibited. No divorce rows were stored. |
| Jackson MO | Probate | already existed | Probate stays on the existing deceased inheritance audience (`prospects.is_deceased`); Case.net is not a second probate pipeline. |
| Jackson MO | Foreclosure notice | already existed | Weekday county_public already pulls Jackson trustee notices from NoticeRegistry and SouthLaw, and Case.net does not replace that pull. |
| Jackson MO | Lis pendens | cannot | Case.net returned HTTP 403 with title Error 403. Automated scraping is expressly prohibited. No lis pendens rows were stored. |
| Jackson MO | Federal tax lien | built | Jackson County public recorder search returns FEDERAL TAX LIEN rows for the recent filing window. Those rows stay on the Liens tab and out of the foreclosure dial queue. |
| Jackson MO | HOA lien | built | HOA liens are LIEN documents on that same public recorder search whose other party is a homeowners or homes association. They stay out of the foreclosure dial queue. |
| Jackson MO | Sheriff sale | already existed | Jackson sale dates already come from the SouthLaw Missouri sales PDF inside county_public when an owner and situs match. |
| Johnson KS | Divorce | cannot | Kansas Case Search blocked this client with Cloudflare and requires an in-browser terms step, so no divorce rows are fetched. |
| Johnson KS | Probate | already existed | Johnson probate stays on the existing deceased inheritance audience; Kansas Case Search is blocked and is not a second pipeline. |
| Johnson KS | Foreclosure notice | already existed | Johnson mortgage filings already come from The Legal Record joined to SouthLaw when a situs exists. |
| Johnson KS | Lis pendens | already existed | Legal Record MF rows that match a SouthLaw Johnson case are already imported as lis pendens on the notice path. |
| Johnson KS | Federal tax lien | cannot | No stable unauthenticated Johnson County lien source was already obvious, and this pass does not add a recorder client. |
| Johnson KS | HOA lien | cannot | No stable unauthenticated Johnson County HOA lien source was already obvious, and this pass does not add one. |
| Johnson KS | Sheriff sale | already existed | Johnson sheriff sales already come from JoCo Sheriff GetAllSales joined to the SouthLaw Kansas PDF. |
| Clay MO | All seven lead types | cannot | Owner limited this pass to Jackson County MO and Johnson County KS, so no fetcher was added. |
| Wyandotte KS | All seven lead types | cannot | Owner limited this pass to Jackson County MO and Johnson County KS, so no fetcher was added. |
| Platte MO | All seven lead types | cannot | Owner limited this pass to Jackson County MO and Johnson County KS, so no fetcher was added. |
| Cass MO | All seven lead types | cannot | No public Cass County source was already obvious in this repo, and paid vendors were not hunted. |

`court_filings` and `recorder_liens` reject `dialer_enrolled = true`. The Liens tab reads the Jackson recorder search directly and does not insert those rows into `mortgage_foreclosure_prospects` or the dial queue.
