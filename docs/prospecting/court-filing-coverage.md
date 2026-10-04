# Jackson and Johnson filings coverage

This pass adds court and lien lanes inside the existing Prospecting page at `/prospecting/foreclosure`. The visible name of that area is Filings. The route is unchanged. Divorces and liens are tabs on that page and are not written into `mortgage_foreclosure_prospects` or the foreclosure dial queue.

Probate is not a new pipeline. It stays on the existing deceased inheritance audience (`prospects.is_deceased`).

Case.net, Kansas Case Search, and the Jackson recorder were probed once. Each failed closed. No rows were invented. None of these probes is on a cron. PropStream is not a source. No skip trace runs here. The $75,000 mortgage equity floor is unchanged.

| County | Lead type | Status | Reason |
| --- | --- | --- | --- |
| Jackson MO | Divorce | cannot | Case.net returned HTTP 403 and says automated scraping of Missouri judicial sites is expressly prohibited, so no divorce rows are stored. |
| Jackson MO | Probate | already existed | Probate stays on the existing deceased inheritance audience (`prospects.is_deceased`); Case.net is not a second probate pipeline. |
| Jackson MO | Foreclosure notice | already existed | Weekday county_public already pulls Jackson trustee notices from NoticeRegistry and SouthLaw, and Case.net does not replace that pull. |
| Jackson MO | Lis pendens | cannot | A Jackson lis pendens court case would come from Case.net, which blocks automated access, and no other stable public feed was added. |
| Jackson MO | Federal tax lien | cannot | The Jackson recorder public search responds with an ASP.NET browser-test login form, so there is no stable unauthenticated lien fetch. |
| Jackson MO | HOA lien | cannot | HOA liens sit on that same Jackson recorder search, which requires a login session this client will not use. |
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

`court_filings` and `recorder_liens` are the landing tables for a future stable public fetch. Both reject `dialer_enrolled = true`. This pass does not insert rows into them.
