import { selectInitialAddresses, contactHygieneReasons } from '../hygiene/guards';
import "server-only";
import type { Sql } from "postgres";
import { z } from "zod";
import { ownerWorkspace } from "../connections/service";
import { check, workflowHash, type Tx } from "../workflow/core";
export const audienceImportSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    idempotencyKey: z.string().uuid(),
    source: z.string().trim().min(3).max(300),
    permissionBasis: z.string().trim().min(10).max(1000),
    rows: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            email: z.string().trim().email().max(320),
            verificationStatus: z
              .enum(["valid", "invalid", "risky", "unknown"])
              .default("unknown"),
            verifiedAt: z.string().datetime({ offset: true }).optional(),
            verificationSource: z.string().trim().min(1).max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
/** Imports evidence; unknown identity/verification stays excluded from launch. */
export async function importAudience(
  sql: Sql,
  subject: string,
  raw: unknown,
  now = new Date(),
) {
  const parsed = audienceImportSchema.safeParse(raw);
  check(parsed.success, "INVALID_IMPORT", 400);
  const input = parsed.data,
    hash = workflowHash(input);
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject);
    const [prior] =
      await tx`select payload_hash,result from em_command_receipts where workspace_id=${ws.id} and actor_id=${subject} and idempotency_key=${input.idempotencyKey}`;
    if (prior) {
      check(prior.payload_hash === hash, "IDEMPOTENCY_MISMATCH");
      return prior.result as {
        entityId: string;
        eligible: number;
        review: number;
        duplicates: number;
        state: string;
      };
    }
    const unique = new Map(
      input.rows.map((row) => [row.email.toLowerCase(), row]),
    );
    const prepared = [];
    for (const [email, row] of unique) {
      const verifiedAt = row.verifiedAt ? new Date(row.verifiedAt) : null;
      check(
        !verifiedAt || verifiedAt <= now,
        "VERIFICATION_DATE_IN_FUTURE",
        400,
      );
      const current =
        verifiedAt &&
        verifiedAt <= now &&
        verifiedAt.getTime() > now.getTime() - 30 * 86_400_000 &&
        row.verificationSource;
      const state =
        row.verificationStatus === "valid" && !current
          ? "unknown"
          : row.verificationStatus;
      const [address] =
        await tx`insert into em_addresses(workspace_id,raw_address,normalized_address,verification_state,verification_provider,verified_at,verification_expires_at,verification_evidence)
    values(${ws.id},${row.email},${email},${state},${row.verificationSource ?? null},${verifiedAt},${current ? new Date(verifiedAt!.getTime() + 30 * 86_400_000) : null},${tx.json({ source: input.source, permissionBasis: input.permissionBasis, importedBy: subject })})
    on conflict(workspace_id,normalized_address) do update set verification_state=case when excluded.verified_at>=em_addresses.verified_at or em_addresses.verified_at is null then excluded.verification_state else em_addresses.verification_state end,
    verification_provider=case when excluded.verified_at>=em_addresses.verified_at or em_addresses.verified_at is null then excluded.verification_provider else em_addresses.verification_provider end,
    verification_expires_at=case when excluded.verified_at>=em_addresses.verified_at or em_addresses.verified_at is null then excluded.verification_expires_at else em_addresses.verification_expires_at end,
    verified_at=greatest(em_addresses.verified_at,excluded.verified_at),revision=em_addresses.revision+1 returning id,verification_state,verification_expires_at`;
      const people =
        await tx`select distinct p.id,p.display_name from crm_contact_methods m join crm_people p on p.id=m.person_id where m.method_type='email' and lower(m.normalized_value)=${email}`;
      const existing =
        await tx`select p.id,p.identity_state from em_parties p join em_party_addresses a on a.party_id=p.id and a.workspace_id=p.workspace_id where p.workspace_id=${ws.id} and a.address_id=${address.id} and a.relationship='confirmed'`;
      let partyId: string | null =
        existing.length === 1 ? existing[0].id : null;
      let confirmed =
        existing.length === 1 && existing[0].identity_state === "confirmed";
      if (!partyId && people.length === 1) {
        const [party] =
          await tx`insert into em_parties(workspace_id,display_name,kind,identity_state,canonical_person_id,identity_evidence)
      values(${ws.id},${people[0].display_name},'seller','confirmed',${people[0].id},${tx.json({ source: "canonical CRM email match", importSource: input.source })})
      on conflict(workspace_id,canonical_person_id) where canonical_person_id is not null do update set updated_at=now() returning id,identity_state`;
        partyId = party.id;
        confirmed = party.identity_state === "confirmed";
        await tx`insert into em_party_addresses(workspace_id,party_id,address_id,relationship,evidence,confirmed_by,confirmed_at)
      values(${ws.id},${partyId},${address.id},'confirmed',${tx.json({ source: "canonical CRM email match" })},${subject},${now}) on conflict do nothing`;
      }
      if (!partyId) {
        const [party] =
          await tx`insert into em_parties(workspace_id,display_name,kind,identity_state,identity_evidence)
      values(${ws.id},${row.name},'unknown','unresolved',${tx.json({ source: input.source, reason: "Confirm recipient identity in CRM" })}) returning id`;
        partyId = party.id;
        await tx`insert into em_party_addresses(workspace_id,party_id,address_id,relationship,evidence) values(${ws.id},${partyId},${address.id},'candidate',${tx.json({ source: input.source })})`;
      }
      const [stop] =
        await tx`select id from em_suppressions where workspace_id=${ws.id} and address_id=${address.id}`;
      if (confirmed) {
        await selectInitialAddresses(tx, ws.id, partyId!);
        await tx`insert into em_party_properties(workspace_id,party_id,canonical_property_id,address,relationship,evidence)
          select distinct p.workspace_id,p.id,l.property_id,cp.address,'unconfirmed',jsonb_build_object('source','Canonical CRM record link; ownership requires review')
          from em_parties p join crm_lead_entity_links l on l.person_id=p.canonical_person_id join crm_properties cp on cp.id=l.property_id
          where p.workspace_id=${ws.id} and p.id=${partyId} and l.property_id is not null on conflict do nothing`;
      }
      const reasons = await contactHygieneReasons(tx, { workspaceId: ws.id, partyId: partyId!, addressId: address.id, now });
      if (!confirmed) reasons.push("identity_review");
      if (
        address.verification_state !== "valid" ||
        !address.verification_expires_at ||
        new Date(address.verification_expires_at) <= now
      )
        reasons.push("address_verification");
      if (stop) reasons.push("marketing_stopped");
      prepared.push({ addressId: address.id, partyId, reasons });
    }
    const eligible = prepared.filter((r) => !r.reasons.length).length;
    const [audience] =
      await tx`insert into em_audiences(workspace_id,name,program,state) values(${ws.id},${input.name},'seller_outreach','ready') returning id`;
    const [snapshot] =
      await tx`insert into em_audience_snapshots(workspace_id,audience_id,source_revision,content_hash,row_count,eligible_count,created_by)
    values(${ws.id},${audience.id},1,${hash},${prepared.length},${eligible},${subject}) returning id`;
    for (const row of prepared)
      await tx`insert into em_snapshot_rows(workspace_id,snapshot_id,party_id,address_id,eligibility,reason_codes,evidence_hash)
    values(${ws.id},${snapshot.id},${row.partyId},${row.addressId},${row.reasons.length ? "needs_review" : "eligible"},${row.reasons},${hash})`;
    const result = {
      entityId: audience.id as string,
      eligible,
      review: prepared.length - eligible,
      duplicates: input.rows.length - prepared.length,
      state: "recipients_imported",
    };
    await tx`insert into em_command_receipts(workspace_id,actor_id,idempotency_key,command,payload_hash,result) values(${ws.id},${subject},${input.idempotencyKey},'AUD-IMPORT',${hash},${tx.json(result)})`;
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail) values(${ws.id},${subject},'AUD-IMPORT',${audience.id},${input.idempotencyKey},${tx.json({ ...result, source: input.source, permissionBasis: input.permissionBasis })})`;
    return result;
  });
}
