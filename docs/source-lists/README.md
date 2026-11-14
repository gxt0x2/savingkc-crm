# Source list import

County and city lead files land in `source_lists` and `source_list_rows`. The CRM row is the current copy. Re-importing the same parcel or case updates that row and records the file. It does not create a second copy, and it does not change a row that a person has already marked `ready`, `excluded_entity`, `dropped`, or `loaded_to_dialer`.

Save `.xlsx` workbooks as CSV first. This path reads CSV only.

## Lanes

| List | `--list-type` | County and state |
| --- | --- | --- |
| Jackson, Clay, or Platte tax delinquent | `tax_delinquent` | That county, `MO` |
| Johnson or Wyandotte tax delinquent | `tax_delinquent` | That county, `KS` |
| Case.net estates | `probate_estate` | `MO`, county optional |
| Case.net no-property follow-up | `probate_no_property` | `MO`, county optional |
| Foreclosure | `foreclosure` | `MO` or `KS`, county optional |
| KC dangerous building, board-up, or structural | `code_violation` | `--violation-kind` `dangerous_building`, `board_up`, or `structural`. State `MO`. County blank, or Jackson, Clay, or Platte. |

Tax, code, and other parcel lists match on parcel id. Probate and foreclosure match on case id when the file has one.

Recognized headers include `parcel_id`, `apn`, `case_number`, `owner_name`, `address`, `amount_owed`, and `phone` / `phone_1` / `phone_2` / `phone_3`. The original cells are kept on the row.

## Dry run, then write

The script does not write unless you pass `--confirm`. It needs the CRM database URL and service role key that the app already uses: `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`. No new secret is required.

```bash
npx tsx scripts/import-source-list-csv.mts \
  --file ./jackson-tax.csv \
  --list-type tax_delinquent \
  --county jackson \
  --state MO \
  --pull-date 2026-11-14 \
  --source-url https://example.com/jackson-tax

npx tsx scripts/import-source-list-csv.mts \
  --file ./jackson-tax.csv \
  --list-type tax_delinquent \
  --county jackson \
  --state MO \
  --pull-date 2026-11-14 \
  --confirm
```

A signed-in CRM user can post the same file to `POST /api/source-lists/import` as JSON (`csv`, `listType`, `county`, `state`, `violationKind`, `pullDate`, `fileName`) or as multipart form data with a `file` field. The import does not send email, SMS, or calls.

Rows start as `new`. An ambiguous property or prospect match starts as `needs_check`. Mark a row by `PATCH /api/source-lists/rows/{id}` with `status` of `ready`, `excluded_entity`, `dropped`, or `loaded_to_dialer`. The status history table records the change.

## Dialer file

Load the dialer from `source_list_dialer_export` only. A signed-in user can download it:

```bash
curl -sS -H "Cookie: <session>" \
  "https://crm.savingkc.com/api/source-lists/dialer-export?listType=tax_delinquent&county=jackson&state=MO"
```

The view keeps `ready` and `loaded_to_dialer` rows. It drops a phone, at the moment of the query, when that number is on `sms_opt_outs`, has a prospect disposition of `dnc` or `do_not_call`, is on voice hold, is opted out or blocked on the CRM contact method, or belongs to a lead whose dead reason or call result is do-not-call. `source_list_dialer_suppressed` lists the numbers that were removed and why. `source_list_dialer_phone_review` includes those numbers, so it is not a load file.

The export does not mark rows `loaded_to_dialer` and does not write `mojo_call_queue`. Set that status after a person loads the scrubbed file.
