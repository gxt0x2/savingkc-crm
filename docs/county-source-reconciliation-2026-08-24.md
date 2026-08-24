# County source reconciliation — 2026-08-24

## Decision

Do not bulk-import the Google Sheets and do not create Leads. The corrected
county files are source evidence for the existing `prospects` inventory. Apply
only uniquely matched, evidence-backed field corrections; quarantine identity
conflicts and unclassifiable rows.

The comparison was read-only. It scanned 24,544 production prospects and
24,210 associated phone rows without inserting, updating, deleting, enrolling,
calling, or messaging anything.

## Source cleanup

- Johnson County: three records were moved from the 2-year skipped sheet to the
  3+ year skipped sheet without dropping any SmartSkip fields.
- Jackson County: deceased rows were removed from the living/skipped subsets;
  two missing deceased rows were preserved in the deceased subset first.
- Clay County: the deceased tab contained the same 49 records repeated twenty
  times. Exact-row deduplication removed 950 duplicate/header rows, leaving one
  header and 49 unique deceased records. A full workbook backup was created
  before deletion.

## Dry-run reconciliation

| County | Source rows | Unique production matches needing update | New | Identity conflicts | Unclassifiable |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jackson | 2,183 | 2,183 | 0 | 0 | 0 |
| Johnson | 1,466 | 1,364 | 16 | 86 | 0 |
| Clay | 348 | 0 | 6 | 341 | 348 |
| **Total** | **3,997** | **3,547** | **22** | **427** | **348** |

The remaining one Clay row already matches production exactly. Production rows
outside these three supplied source files are not classified as stale or
orphaned by this audit.

### Evidence-backed differences

| County | Property class | Delinquency bucket | Deceased flag | Prospect phone sets |
| --- | ---: | ---: | ---: | ---: |
| Jackson | 2,183 | 0 | 0 | 0 |
| Johnson | 1,364 | 452 | 1 | 4 prospects / 12 phones |
| Clay | 0 | 0 | 0 | 0 |

Jackson is the clean first wave: all 2,183 rows match one production prospect,
and their only difference is the explicit county/import property class.

Johnson is suitable for a second guarded wave. Property class and delinquency
can be corrected on the 1,364 unique matches. The one deceased-state difference
and four phone-set differences require record-level review before any write.
The 86 identity conflicts and 16 new rows must not be guessed or auto-promoted.

Clay is blocked from campaign eligibility. Its SmartSkip workbook contains
names, addresses, deceased status, and phones, but no parcel ID or delinquency
year. It cannot truthfully be placed into 2-year or 3+ Saved Views until the
original Clay County tax source is supplied and joined.

## Proposed production waves

1. **Wave A — Jackson property classification:** update 2,183 uniquely matched
   prospects to `residential` or `land` from the explicit corrected source
   tabs. No phone, deceased, lead, campaign, or lifecycle changes.
2. **Wave B — Johnson safe fields:** update property class on 1,364 unique
   matches and correct 452 delinquency buckets. Exclude the deceased mismatch,
   phone differences, identity conflicts, and new records.
3. **Review queue:** inspect one Johnson deceased mismatch, four Johnson phone
   differences, 86 Johnson identity conflicts, and 16 Johnson new rows.
4. **Clay source recovery:** obtain parcel IDs and delinquency years, then rerun
   the same reconciliation. Do not infer year from the SmartSkip file.

Every apply wave must use a frozen source fingerprint, fail on source drift,
run in a transaction, log before/after values, and emit zero campaign members,
Leads, calls, or messages.

## Wave A production result

Applied on 2026-08-24 at approximately 15:19 CDT.

- Batch: `874044d9-0acb-49a9-83e0-3c8c62548916`
- Frozen source SHA-256: `9daa048b50f20244e79fa55ee51b12ae0d607c7cc7d5cf69386aafb7932418b4`
- Frozen target-plan SHA-256: `1de98a81d67c4bee1e181842f8deb69227376fbc71ca7d2d51c3120d164828ce`
- Updated and audited: 2,183 unique Jackson County prospects
- Result: 1,950 `residential`; 233 `land`; zero post-apply mismatches
- Saved View segments: 2-year Residential 1,047; 2-year Land 138;
  3+-year Residential 903; 3+-year Land 95. Deceased remains a separate
  filter (86 in 2-year Residential and 93 in 3+-year Residential).
- The apply function updates only `prospects.property_class`. Production has no
  `prospects` trigger on that column, so the wave emitted no campaign members,
  Leads, calls, messages, lifecycle changes, or phone changes.

An immediate read-only rerun found all 2,183 targets in the applied state. The
audit table has RLS enabled; `anon` and `authenticated` have neither table read
access nor function execution permission.
