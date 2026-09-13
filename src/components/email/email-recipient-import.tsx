"use client";
import { useRef, useState } from "react";
import styles from "./email-workspace.module.css";
import { parseRecipientCsv } from "./recipient-csv";
export function EmailRecipientImport({
  onImported,
}: {
  onImported: () => Promise<unknown>;
}) {
  const [name, setName] = useState(""),
    [source, setSource] = useState(""),
    [basis, setBasis] = useState(""),
    [csv, setCsv] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  return (
    <details className={styles.operations}>
      <summary>Import recipient list</summary>
      <form
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const rows = parseRecipientCsv(csv),
              body = JSON.stringify({
                name,
                source,
                permissionBasis: basis,
                rows,
              });
            if (attempt.current?.body !== body)
              attempt.current = { body, key: crypto.randomUUID() };
            const response = await fetch("/api/email/audiences", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...JSON.parse(body),
                idempotencyKey: attempt.current.key,
              }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(
                result.error?.code?.replaceAll("_", " ") ?? "Import failed",
              );
            setMessage(
              `${result.eligible} eligible · ${result.review} need identity or address review · ${result.duplicates} duplicates removed. No emails sent.`,
            );
            await onImported();
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "Import failed",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Use existing CRM contacts with current address-verification evidence.
          Unknown identities and unverified addresses stay excluded from
          sending.
        </p>
        <label>
          List name
          <input
            required
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Source or report name
          <input
            required
            minLength={3}
            maxLength={300}
            value={source}
            disabled={busy}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label>
          Why these recipients may receive this campaign
          <textarea
            required
            minLength={10}
            maxLength={1000}
            value={basis}
            disabled={busy}
            onChange={(e) => setBasis(e.target.value)}
          />
        </label>
        <label>
          CSV data
          <textarea
            required
            rows={5}
            value={csv}
            disabled={busy}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="name,email,verification_status,verified_at,verification_source"
          />
        </label>
        <p>
          Use verification_status “valid” only with a dated verification report
          from the last 30 days. verified_at uses an ISO date such as
          2026-09-13T12:00:00Z. Maximum 200 rows.
        </p>
        <button disabled={busy} className={styles.primary}>
          {busy ? "Importing…" : "Import for review"}
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}
