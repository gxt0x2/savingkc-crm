# SavingKC CRM Downtime Reconciliation Report

Generated: 2026-07-08T01:14:24Z
Updated: 2026-07-08T13:46:44Z
Mode: initial evidence pass was read-only; strict outage-window production backfill was applied after approval.

## Outage Window

- Last known good scheduled PPC export: 2026-07-06T19:19:34Z (July 6, 2026 2:19:34 PM Central), GitHub run `28817129210`.
- First broad Vercel/Supabase-backed failure observed: 2026-07-06T21:02:40Z (July 6, 2026 4:02:40 PM Central).
- First failed scheduled PPC export: 2026-07-06T21:11:15Z (July 6, 2026 4:11:15 PM Central), GitHub run `28823558549`.
- Recovery confirmed: 2026-07-08T00:50:18Z (July 7, 2026 7:50:18 PM Central), GitHub rerun `28907735175`.
- Strict observed outage duration: 1,668 minutes, about 27 hours 48 minutes.
- Conservative max window from last good workflow to recovery: 1,771 minutes, about 29 hours 31 minutes.

Root cause evidence: Supabase REST/PostgREST was unhealthy and returning upstream connection timeouts plus Cloudflare 520/521 responses. The app shell could still redirect to login, but Supabase-backed reads/writes were failing.

## CRM Write Evidence

Counts from production Supabase:

| Table | Uncertainty buffer 2026-07-06 2:19-4:02 PM CT | Observed outage 2026-07-06 4:02 PM to 2026-07-07 7:50 PM CT | Post-recovery grace to 10:00 PM CT |
| --- | ---: | ---: | ---: |
| `lead_activities` | 2 | 0 | 0 |
| `leads` | 0 | 0 | 0 |
| `ppc_tracking_events` | 0 | 0 | 1 |
| `ppc_conversion_outbox` | 0 | 0 | 0 |

Latest `lead_activities` before the outage were two call rows at 2026-07-06T19:52:23Z and 2026-07-06T19:52:29Z. No CRM lead/activity rows were created during the observed outage.

## Twilio Reconciliation

Twilio provider activity in the conservative window:

- Messages total: 22
- Inbound SMS: 3, all `received`
- Outbound SMS: 19, all `delivered`
- Calls total: 7
- Inbound calls: 6, five `completed`, one `no-answer`
- Outbound calls: 1, `no-answer`

CRM match results:

- Strict observed outage missing items: 3 inbound SMS and 4 inbound calls.
- Conservative window adds 1 missing inbound call from the uncertainty buffer.
- One uncertainty-buffer call already has a matching CRM activity and should not be backfilled.

### Missing Inbound SMS

| Time CT | Twilio SID | From | To | CRM match | Proposed action |
| --- | --- | --- | --- | --- | --- |
| 2026-07-07 2:35:20 PM | `SMad9ca5692f805851c120f79fa555a003` | `***4008` | `***2900` | Existing lead `003daa97-f908-4d37-a1eb-6f51a814ceda`, station `dead`, source `inbound_sms` | Insert inbound SMS `lead_activities` row on matched lead. |
| 2026-07-07 10:57:17 AM | `SM219713325a472b98ce78ae56fc3bcdaf` | `***4750` | `***1344` | No lead; one prospect match: Dorothy Deboard, Johnson County, 2yr, owner phone | Create/link lead from prospect once, then insert inbound SMS activity. |
| 2026-07-07 10:56:39 AM | `SM1bff2f132f2d0567f927f8a51c568e26` | `***4750` | `***1344` | Same prospect as above | Insert second inbound SMS activity against same created/linked lead. |

### Missing Inbound Calls

| Time CT | Twilio SID | Status | Duration | From | To | CRM match | Proposed action |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| 2026-07-07 4:45:45 PM | `CAe0a7ad9cf6b1ddf731e3ed3fb70719b4` | completed | 11s | `***9484` | `***8032` | No lead/prospect match | Create generic inbound-call lead or unmatched activity according to backfill policy. |
| 2026-07-07 11:48:06 AM | `CAa0e698d70a9e40072ab1d96c238e6e57` | completed | 1s | `***2693` | `***8107` | Prospect: Kelly Rogers, Johnson County, 2yr, owner phone | Create/link lead from prospect and insert inbound call activity. |
| 2026-07-07 11:24:17 AM | `CA419a2e2a8fa0bbd222d8849f76ef8c75` | no-answer | 0s | `***9564` | `***8588` | Existing lead `24a1fd7f-a31d-41ea-aae0-7948516dd37c`, Jill Woods, station `under_contract` | Insert missed inbound call activity and callback task if still operationally relevant. |
| 2026-07-06 5:08:42 PM | `CA1d003a9984e681d195988b44617ba95d` | completed | 0s | `***5552` | `***8107` | Prospect: Homer Damet, Johnson County, 3yr_plus, owner phone | Create/link lead from prospect and insert inbound call activity. |
| 2026-07-06 3:39:58 PM | `CA8baaa74475920ceeeecb81ca290f9911` | completed | 5s | `***0627` | `***0845` | Prospect: Kurt Dutton, Johnson County, 3yr_plus, owner phone | This is in the uncertainty buffer. Backfill only if treating the max window as affected. |

Already matched, do not backfill:

| Time CT | Twilio SID | Status | Duration | Note |
| --- | --- | --- | ---: | --- |
| 2026-07-06 2:52:08 PM | `CAd3f48287f866e044ed1e008541337df0` | completed | 20s | CRM activity already exists. |

## Ads And PPC Reconciliation

PPC conversion outbox all-time status after recovery:

| Status | Count |
| --- | ---: |
| pending | 0 |
| processing | 0 |
| failed | 0 |
| dead_letter | 0 |
| skipped | 2 |
| sent | 8 |

Reporting rows currently present:

| Date | Google campaign daily | Google search-term daily | OpenAI campaign daily |
| --- | ---: | ---: | ---: |
| 2026-07-06 | 0 | 0 | 2 |
| 2026-07-07 | 0 | 0 | 0 |
| 2026-07-08 | 0 | 0 | 0 |

Notes:

- The latest PPC export rerun after recovery succeeded and returned zero scanned, zero pending, zero failed, and zero missing config.
- OpenAI Ads campaign rows for 2026-07-06 were inserted at recovery time. July 7 still needs an OpenAI reporting sync once that date is reportable.
- Google Ads reporting has no campaign/search-term rows for July 6-8 in the current table snapshot. The Google Ads reporting sync was still returning `Bad Request` after Supabase recovered, so this should be investigated separately before write-mode backfill.

## Website Forms And Tracking

- CRM `leads` count during observed outage: 0.
- CRM `ppc_tracking_events` count during observed outage: 0.
- CRM `ppc_conversion_outbox` count during observed outage: 0.
- If a website form POST only hit `https://crm.savingkc.com/api/leads` during the outage, the CRM does not contain enough evidence to reconstruct it.
- Potential recovery sources are first-party partial capture, provider-side ad/conversion records, Vercel request logs if body capture exists, and any notification emails/SMS generated outside the failed CRM write path.

## Proposed Backfill Order

1. Create a dry-run backfill script that re-queries Twilio by SID and builds the exact rows it would insert.
2. Add idempotency checks on `lead_activities.metadata.message_sid` and `lead_activities.metadata.callSid`.
3. For the two Dorothy Deboard SMS rows, create/link one prospect-backed lead, then insert both inbound SMS activities.
4. For the matched existing lead SMS and Jill Woods missed call, insert only the missing activity/task rows.
5. For Kelly Rogers, Homer Damet, and optionally Kurt Dutton, create/link prospect-backed leads and insert call activities.
6. For the unmatched `***9484` call, create either a generic inbound-call lead or an unmatched activity according to the desired CRM policy.
7. Re-run PPC conversion export in validate-only mode, then normal mode only if validate-only remains clean.
8. Investigate Google Ads reporting `Bad Request`, then re-run Google Ads reporting sync for 2026-07-06 through 2026-07-08.
9. Re-run OpenAI Ads reporting sync for 2026-07-07 once available.
10. Add a durable raw-webhook/event queue outside Supabase before changing webhook retry behavior.

## Prevention Items

- Add Supabase Management API health monitor for `rest`, `db`, `auth`, `storage`, `pooler`, and `pg_bouncer`.
- Add a cooldown-protected automatic Supabase restart path when `rest` is unhealthy and the CRM is returning broad upstream timeouts.
- Add a post-recovery reconciler that audits Twilio, PPC outbox, tracking events, and ad reporting tables for the affected window.
- Store raw inbound provider payloads outside Supabase before attempting CRM writes.
- Stop returning webhook success for failed DB writes unless the raw payload is durably queued elsewhere.
- Move delayed SMS work out of serverless `setTimeout` and into a durable worker queue.
- Use provider IDs (`MessageSid`, `CallSid`, `RecordingSid`) as idempotency keys.
- Schedule the available Supabase project upgrade.

## Dry-Run Backfill Tool

Script added: `scripts/reconcile-crm-downtime-backfill.mjs`

Validation run:

```bash
node --check scripts/reconcile-crm-downtime-backfill.mjs
node scripts/reconcile-crm-downtime-backfill.mjs
node scripts/reconcile-crm-downtime-backfill.mjs --include-uncertainty-buffer
```

Initial strict outage-only dry-run result before any writes:

- Plans: 8
- Production writes if applied: 15
- Existing/skipped controls: 1
- Included missing items: 3 inbound SMS, 4 strict-outage inbound calls, and 1 known matched control call.
- Excluded by default: 1 optional uncertainty-buffer inbound call.

Strict apply candidate:

- Insert one inbound SMS activity on existing lead `003daa97-f908-4d37-a1eb-6f51a814ceda`.
- Create/link one Dorothy Deboard prospect-backed lead and insert two inbound SMS activities against it.
- Create one generic inbound-call lead for the unmatched `***9484` call and insert its call activity.
- Create/link one Kelly Rogers prospect-backed lead and insert its call activity.
- Insert Jill Woods missed-call activity and a callback task on existing lead `24a1fd7f-a31d-41ea-aae0-7948516dd37c`.
- Create/link one Homer Damet prospect-backed lead and insert its call activity.
- Skip known matched control call `CAd3f48287f866e044ed1e008541337df0`.

The script defaults to dry-run and refuses writes unless both flags are present:

```bash
node scripts/reconcile-crm-downtime-backfill.mjs --apply --confirm-production-write
```

Optional max-window call:

```bash
node scripts/reconcile-crm-downtime-backfill.mjs --include-uncertainty-buffer --apply --confirm-production-write
```

## Production Apply Result

Strict outage-only apply command:

```bash
node scripts/reconcile-crm-downtime-backfill.mjs --apply --confirm-production-write
```

Apply notes:

- The first apply wrote the matched-lead SMS for `SMad9ca5692f805851c120f79fa555a003`, then stopped on production `leads_source_check`.
- The script was updated to use live CRM source values (`tax_delinquent_inbound_sms`, `inbound_sms`, `inbound_call`) and to use production-accepted station `new` for newly created leads.
- This exposed production schema drift: repo migrations and several live routes still reference `station: 'intake'`, but current production lead rows use `new`, `contacted`, `qualified`, `under_contract`, and `dead`.
- The final strict apply completed successfully. The script is idempotent, so the partial first SMS write was skipped during the final apply.

Rows now present for incident `crm_downtime_2026_07_06`:

| Item | Count |
| --- | ---: |
| Backfilled SMS activities | 3 |
| Backfilled call activities | 4 |
| Backfilled callback tasks | 1 |
| New leads created | 4 |

Created leads:

| Lead | Source | Station | Priority | Note |
| --- | --- | --- | --- | --- |
| Dorothy Deboard | `tax_delinquent_inbound_sms` | `new` | `warm` | Prospect linked; two SMS activities inserted. |
| Inbound Call `***9484` | `inbound_call` | `new` | `warm` | Generic inbound-call lead; no prospect match. |
| Kelly Rogers | `inbound_call` | `new` | `hot` | Prospect linked; call activity inserted. |
| Homer Damet | `inbound_call` | `new` | `hot` | Prospect linked; call activity inserted. |

Existing leads updated with activities:

- Existing SMS lead `003daa97-f908-4d37-a1eb-6f51a814ceda`: one inbound SMS activity inserted.
- Jill Woods `24a1fd7f-a31d-41ea-aae0-7948516dd37c`: one missed-call activity and one callback task inserted.

Final verification:

- `node scripts/reconcile-crm-downtime-backfill.mjs` returned `Plans: 8`, `writes planned: 0`, `Existing/skipped controls: 8`.
- GitHub scheduled PPC export is back to green; latest checked run was `28944962845` at 2026-07-08T13:06:38Z.
- The optional uncertainty-buffer call `CA8baaa74475920ceeeecb81ca290f9911` was not applied.
