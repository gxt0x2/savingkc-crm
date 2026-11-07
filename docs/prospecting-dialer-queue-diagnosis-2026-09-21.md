# Prospecting dialer queue diagnosis (2026-09-21)

Investigation only. No dialer rewrite. Codex session/attempt contracts left untouched.
Live reads were against Supabase project `fprrknfyzlthbxewnwmi`. `mojo_call_queue` was not drained or rewritten.

## Verdict for Ernest

The live first-pass list **Jackson · Tax 3+ · 7 zips · Aug 30** (`74609ed4-7e26-4111-b626-b2e3f68efa0b`) is not losing members to Remine, RLS, or a broken next-contact selector.

It is **almost fully worked**. The dialer can only claim `active` members. That leaves **three people**. Every new session’s queue is exactly those three. Skip or idle does **not** complete them, so they are released and claimed again. After the third skip the session marks itself `completed` and calling stops.

The Aug 30 / Sep 2–3 names that “vanished” are still in the database as **completed members** (or on the separate Sep 2 Deceased campaign). They are excluded from the next-contact query on purpose.

| Layer | Finding |
| --- | --- |
| Data | **Primary cause.** 149 of 169 Aug 30 members are completed with real dispositions. 3 active leftovers recycle. |
| Code | Skip/idle does not consume a member. Session start only looks at `status = 'active'`. Not a layout rewrite of next-contact. |
| Remine | **Not in the Aug 30 queue.** Four archived Remine campaigns still appear in Ernest’s picker. They cannot be launched. |
| Sessions | **No open/paused row right now.** Historical paused rows would block campaign switching. They are not the current 3-name loop. |
| Mic test | Client-only. Can block placing a call. Does not write queue or sessions. |

---

## 1. Why next-contact stops after a few names

### Live counts (Aug 30 campaign)

| Member status | Count | With a saved call disposition | Still holding `dialer_session_id` |
| --- | ---: | ---: | ---: |
| `active` | 3 | 1 | 0 |
| `completed` | 149 | 149 | 148 (stale; session already ended) |
| `suppressed` | 17 | 6 | 7 (stale) |
| **total** | **169** | | |

Dashboard “ready to call” is `stats.active`, which is a count of `status = 'active'` (`getProspectingCampaign` in `src/lib/server/prospecting-campaigns.ts`). That number is **3**, not 169.

### The three leftovers (the repeating names)

All three still have `status = 'ready'` contact snapshots. None are reserved. None are on Remine campaigns.

| Member | Subject | Property | Contacts | Call history |
| --- | --- | --- | --- | --- |
| `30af6c98-7ac0-4729-96a5-8883032c933e` | prospect Dickerson / Kortnie | 7810 E 67th St, 64133 | 4 ready | 3 `no_answer` on Sep 2 and Sep 10; one mobile still unattempted |
| `dbba231d-5c24-4f3e-8d0e-494ee811f9a7` | lead Jackie Daniels | 8807 Bristol Ave | 3 ready | **never dispositioned** |
| `c0b74981-c3e1-4d48-9f78-fe25faaa7dc0` | prospect Wrenn | 7637 Washington St, 64114 | 1 ready | **never dispositioned** |

Enrollment: two from the Aug 30 county saved view, one from `smartskip_124_2026-08-30`. No Sep 2–3 enrollments on this campaign.

### Today’s sessions (proof of the loop)

Queried `dialer_sessions` for campaign `74609ed4-…` on 2026-09-21:

| Session | Actor | Duration | Queue | Dials | Skips | End |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `1d3a95d0-…` | casey@savingkc.com | 31s | 3 | 0 | 3 | `completed` |
| `cf4eb052-…` | ernest@savingkc.com | 17s | 3 | 0 | 3 | `completed` |

Ernest’s `queue_snapshot` was exactly the three leftover member IDs. Events: `session_started` → three `subject_skipped` / `session_skip` (“Agent skipped this contact”) → session `completed`. Zero `dialer_session_attempts` on that session.

`release_prospecting_dialer_batch_v1` then cleared `dialer_session_id` on those three **because they were still `active`**. The next launch claims the same three again.

The same 3-person queue has been the only claimable batch since about Sep 10 (Casey `1c57a891` still had 11; later sessions are size 3). Sep 16 Ernest sat 16 minutes on index 0 with 0 dials / 0 skips and idle-timed out. That is “cannot or did not place a call,” sitting on leftover #1, not a missing-list bug.

### Where Aug 30 / Sep 2–3 members went

**They were worked, not deleted.**

- Aug 30 living list enrollments: 3 active + 149 completed + 14 suppressed on Aug 30, plus 3 suppressed on Sep 1. Nothing enrolled on Sep 2 or Sep 3 into this campaign.
- Sep 2–3 on the calendar was Casey **dialing** the Aug 30 list (100-person batches, 91 and 116 dials). Completing a member fires `lead_completed` / `subject_completed` → `project_prospecting_dialer_event_v1` sets `status = 'completed'`. Next-contact then excludes them.
- Separate campaign **Jackson · Tax 3+ · Deceased · Sep 2** (`eac5fbe3-47f5-4ef9-a91a-ef6e222923d6`): 18 members, all `completed`, campaign `completed` on Sep 16. That pile was never part of the Aug 30 living first-pass queue.

Membership vs dialable (Aug 30):

- Members (non-removed): 169
- Dialable under current start SQL: 3
- Completed with a disposition: 149
- Suppressed: 17

RLS is not hiding rows from the service-role RPCs used by launch. Live SQL counts match the campaign stats query.

---

## 2. Next-contact / queue selection path

Server-owned. Browser does not pick the next campaign member.

```
CampaignDashboard.onLaunchDialer
  → ProspectingWorkspace launch
  → launchProspectingDialerCampaign()          src/lib/server/prospecting-campaigns.ts
      expireIdleCampaignDialerSessions()       src/lib/server/prospecting-dialer-reservations.ts
      rpc start_prospecting_dialer_session_v5  wraps v4
  → start_prospecting_dialer_session_v4()      supabase/migrations/20261019120000_prospecting_dialer_session_setup.sql
      optional resume of the actor’s open session
      else claim up to 100 members into queue_snapshot
      start_dialer_session_v2()
  → calling floor reads session.queueItems
      ProspectingCallingFloor.applySessionQueue
      HeirsSection + GET /api/heirs
      skipCurrentLead → transition session action 'skip'
```

Advance after a real call: disposition → `advance_dialer_session_v2` (`advanceDialerSessionAfterDisposition` in `src/lib/server/dialer-session-engine.ts`). A skip uses `transition_dialer_session` / stop-lifecycle skip branch, not advance-after-disposition.

### Filters that exclude a member from the next batch

From `start_prospecting_dialer_session_v4` (the live start path):

1. `prospecting_campaigns.status` must be `active` and `kind = 'dialer'`.
2. Actor already has an `active` or `paused` session on **another** campaign → `another_dialer_session_open`.
3. `prospecting_campaign_members.status = 'active'` only. **Completed, suppressed, needs_review, replied, removed are out.**
4. `dialer_session_id IS NULL` (reserved by any still-linked session). Open-session reservations matter; stale IDs on *completed* rows do not, because those rows already fail filter 3.
5. At least one `prospecting_campaign_member_contacts` row with `status = 'ready'`.
6. `prospecting_dialer_phone_is_eligible_v1` — recency only (`notDialedHours` / `notContactedHours`). Today’s launches had both `null`, so recency did not shrink the three.
7. `ORDER BY enrolled_at, id LIMIT 100` — batch cap, not a hide.

Launch then maps empty-filter vs reserved:

- `campaign_session_filters_empty` if no row passes 3–6
- `campaign_session_reserved` if every remaining **active** row is reserved (`campaignDialerQueueIsReserved`)
- `campaign_dialer_complete` is the older “no callable members” signal

Floor-only filters (do **not** remove the member from the next session):

- `applyCampaignContactCallPolicy` / `evaluateOutboundDialerCall` in `GET /api/heirs` — live DNC / policy. Session start does **not** run this. A member can be claimed and then look uncallable on the floor.
- `isAutoCallablePhone` in `src/lib/heir-dialer-queue.ts` — suppressed, removed, disconnected, hard-stop disposition.
- Skip (`subject_skipped`) increments `dialer_sessions.skips` and `current_index`. It does **not** set member `completed`.
- Idle timeout stops the session and releases active reservations.

Member completion (the only durable exit from the dial queue besides suppress/remove):

- `project_prospecting_dialer_event_v1` on `lead_completed` / `subject_completed` (`supabase/migrations/20261006123000_subject_aware_dialer_sessions.sql`).

---

## 3. Remine in the dialer picker

Live Remine campaigns (all `archived` 2026-09-15, owner Ernest):

| Campaign | Members still `active` |
| --- | ---: |
| Jackson · Remine · living phone · Sep 14 | 442 |
| Clay Platte · Remine · living phone · Sep 14 | 346 |
| Clay Platte · Remine · Deceased · Sep 14 | 7 |
| Jackson · Remine · Deceased · Sep 14 | 6 |

They are **not** mixed into Aug 30 `queue_snapshot`. Separate `campaign_id`s. Launch requires `status = 'active'`, so archived Remine cannot start a session.

They **do** appear in Ernest’s picker:

- `listProspectingCampaigns` returns every campaign he owns, plus team `active` dialers (`src/lib/server/prospecting-campaigns.ts`).
- `isProspectingDialerPickerCampaign` only hides `draft` and names/ids containing Pilot (`src/lib/prospecting/campaign-contract.ts`).
- `CampaignDashboard` uses that filter. Completed Sep 2 Deceased and the four archived Remine lists therefore show next to the live Aug 30 list.

Casey, not being the owner, only sees `kind = 'dialer' AND status = 'active'`. After the Pilot hide, Casey’s picker is effectively Aug 30 only — which is why both operators keep landing on the three leftovers.

**Should Remine be hidden?** Yes, from the *live prospecting dialer picker*. They are a different pile, already archived, and must not be startable as Tax 3+ first-pass. Keep them out of `isProspectingDialerPickerCampaign` (and/or require `status === 'active'`). Do not enroll Remine members onto `74609ed4-…`.

---

## 4. Open / paused `dialer_sessions` (code-level)

Live right now: **none**.

```
status = stopped   20
status = completed  7
status IN (active, paused) OR ended_at IS NULL   0
```

Unique index `idx_dialer_sessions_one_open_per_actor`:

```sql
UNIQUE (lower(actor_email))
WHERE actor_email IS NOT NULL AND status IN ('active', 'paused')
```

Paused **does** count as open. `start_prospecting_dialer_session_v4` loads that row `FOR UPDATE`. Same campaign + `startBehavior = 'resume'` returns the existing session (same `queue_snapshot` / `current_index`). Different campaign raises `another_dialer_session_open`. That is the ops lock: one open row per `ernest@savingkc.com` blocks switching.

Not the bug as of this read. Ernest’s latest Aug 30 session (`cf4eb052-…`) is `completed`. Older long pauses (Aug 31–Sep 1, ~28 hours) would have blocked switching then; they are `stopped` now.

Idle expiry: `expire_dialer_session_if_idle_v1` / `expireIdleCampaignDialerSessions` before launch. Releases **active** member reservations only.

---

## 5. Owner hypotheses

### 1. New layout migration broke next-contact — **discard as the SQL cause**

Queue membership is chosen in `start_prospecting_dialer_session_v4`, not in the calling-floor layout. Today’s snapshots contain the three leftover subjects, including two unpromoted prospects. `ProspectingCallingFloor.applySessionQueue` prefers `session.queueItems` over legacy `leadIds`.

The object-shaped `queue_snapshot` (`kind` / `campaignMemberId`) is the subject-aware contract. A client that only read UUID `leadIds` would see an empty list — that is not what today’s skip events show.

Layout/heirs rendering can still make a leftover **look** undialable (policy 503, empty heirs, compact rail). That is secondary. It does not hide the 149 completed members.

### 2. Microphone testing polluted sessions or queue — **discard as queue pollution**

Mic check is `sessionStorage` + `getUserMedia` (`src/lib/telephony/selected-microphone.ts`, `DialerMicrophoneControls`). It does not insert `dialer_sessions` or change member status.

It **can** block `prepareCallMicrophone` (“Finish the microphone check or current call before dialing”). That matches “I sat on a name and could not call” (Sep 16 idle timeouts). It does not create the 3-name recycle.

### 3. Remine lists should not be in the prospecting dialer — **confirm for picker; discard as queue contamination**

Correct product rule. Remine is archived and still listed for Ernest. It is not why Aug 30 next-contact is three names.

---

## 6. Recommended surgical plan (smallest diffs)

Do **not** scrap the dialer. Do **not** rebuild queue selection. Preserve: one open session per actor, disposition before advance, `stop_requested_at`, subject-aware `queue_snapshot`, campaign-member snapshots.

### Ops now (no code)

1. Treat Aug 30 first-pass as **worked**. 149 completed with dispositions is the list, not a disappearance.
2. The repeating three are Dickerson / Jackie Daniels / Wrenn. They are still `active` and still have ready phones, including never-called numbers.
3. To see the 149 again, use **Run list again** (`rerun_prospecting_dialer_campaign_v1`) only after the campaign can complete — today it stays `active` because of the three leftovers. Completing or suppressing those three after a human look is a data decision, not a rewrite.
4. Do not reopen Remine from the prospecting dialer.

### Tiny code (separate, later PRs)

1. **Picker:** `isProspectingDialerPickerCampaign` → require `status === 'active'` and reject `/\bremine\b/i` in the name. Update `campaign-contract.test.ts` / dashboard test. Hides archived Remine and completed Sep 2 from the live start dropdown. Launch already refuses non-active.
2. **Skip recycle (product call required):** skip currently means “not now” and the member stays `active`. If skip should mean “done for this pass,” set a durable flag or complete-on-skip-last-pass inside the existing skip branch — do not invent a second queue. Until that product call, the three will keep coming back.
3. **Eligibility mismatch (only if floor shows no numbers):** session start uses recency; `/api/heirs` uses `evaluateOutboundDialerCall`. If the floor 503s or suppresses every snapshot, either surface that error and refuse skip-through, or apply the same policy at claim time. Do not silently drop members.
4. **Hygiene only:** 148 completed + 7 suppressed rows still store ended `dialer_session_id`s because `release_prospecting_dialer_batch_v1` only clears `status = 'active'`. Harmless for next-contact. Optional `SET dialer_session_id = NULL` on terminal members whose session is `stopped`/`completed`.

### Explicitly out of scope

- Rewriting `start_prospecting_dialer_session_v4` / session engine
- Touching `mojo_call_queue`
- Merging Remine members into Aug 30
- Auto-rerunning 149 completed members without the existing rerun RPC

---

## Evidence queries (read-only)

```sql
-- Campaign catalog
SELECT id, name, kind, status, created_at, completed_at
FROM public.prospecting_campaigns
ORDER BY created_at;

-- Aug 30 membership vs dialable
SELECT status, COUNT(*) ,
       COUNT(*) FILTER (WHERE dialer_session_id IS NOT NULL) AS reserved
FROM public.prospecting_campaign_members
WHERE campaign_id = '74609ed4-7e26-4111-b626-b2e3f68efa0b'
GROUP BY status;

-- Open sessions (should be empty if the loop is the current bug)
SELECT id, status, actor_email, prospecting_campaign_id, queue_size, current_index
FROM public.dialer_sessions
WHERE status IN ('active', 'paused');
```

This branch does not change runtime behavior.
