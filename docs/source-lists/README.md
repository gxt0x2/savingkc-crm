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

Rows start as `new`. An ambiguous property or prospect match starts as `needs_check`. Mark a row by `PATCH /api/source-lists/rows/{id}` with `status` of `ready`, `excluded_entity`, `dropped`, or `loaded_to_dialer`. The status history table records the change. `loaded_to_dialer` also requires `exportBatchId` from the scrubbed download. That write stores `loaded_at` and the batch id.

## Dialer file

Load the dialer from `source_list_dialer_export` only. A signed-in user can download it:

```bash
curl -sS -H "Cookie: <session>" \
  "https://crm.savingkc.com/api/source-lists/dialer-export?listType=tax_delinquent&county=jackson&state=MO"
```

The view keeps `ready` and `loaded_to_dialer` rows. Mojo `disposition_raw` is classified before `outcome`, so `Fax` and `DNC Number` stored as `other` still block. A stamp never downgrades a stronger label, and `no_answer` does not replace `fax`, `bad_number`, or `not_in_service`. A manual `mojo_dnc_contact_fanout` voice hold spreads across that person's phones and the same property; a copy on another property is `needs_counsel_review`. Lead `dead_reason` `dnc` fans out unless the call result is `DNC Number` only. A missing `mojo_encode_queue` is a no-op. At read time, `source_list_phone_block_reason_v1` drops a phone when `dialer_suppression_class_v1` classifies it, including prospect DNC labels (`dnc`, `do_not_call`, `dnc_number`, `dnc_contact`, `take_me_off`), dead or fax dispositions, wrong-number and disconnected stamps, lead DNC and dead-number call results, lead dead reasons `dnc_refused`, `dnc`, `do_not_call`, `wrong_or_disconnected`, and `disconnected`, a Mojo outcome of `dnc` or `disconnected`, SMS opt-out, voice hold, and a blocked or opted-out contact method. `dnc_contact`, `take_me_off`, and lead `dnc_refused` also fan out to the rest of that prospect, the same household (county, normalized street, and owner last name), and the same Mojo contact. `dataskip_dnc` stays exportable. An unclassified label fails closed. Associate and unknown ties are excluded. A relative is excluded when an owner phone on the same parcel, or the same county and street, has a do-not-call source (`property_owner_dnc_fanout`). Multi-line export is suspended: `lineMode` greater than 1 is refused. `source_list_dialer_suppressed` lists each removed number and `block_reason`. The download reports excluded counts and masks those phones to the last 4 digits.

The download records that scrub as an export batch. The response header `X-Source-List-Export-Batch` and the `export_batch_id` column are that id. After the file is loaded, mark the rows `loaded_to_dialer` with that `exportBatchId`. The export itself does not change row status and does not write `mojo_call_queue`.
