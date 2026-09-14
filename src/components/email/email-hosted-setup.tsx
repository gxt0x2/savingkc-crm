"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./email-workspace.module.css";
type Setup = {
  readiness: {
    ready: boolean;
    blockers: string[];
    sendingEnabled: boolean;
    revision: number;
  };
  testRecipient: string | null;
  domains: {
    domains: { id: string; name: string; state: string }[];
    senders: {
      id: string;
      from_name: string;
      local_part: string;
      domain_id: string;
    }[];
  };
};
export function EmailHostedSetup({
  onChange,
  revision,
}: {
  revision: number;
  onChange: () => Promise<unknown>;
}) {
  const [data, setData] = useState<Setup | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState(""),
    [sender, setSender] = useState("");
  const testKey = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/email/setup", { cache: "no-store" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error?.code ?? "Setup unavailable");
    setData(body);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh, revision]);
  async function act(payload: object) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const r = await fetch("/api/email/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error?.code ?? "Action failed");
      setStatus(
        result.delivery?.state === "accepted"
          ? "Test accepted by Resend. Reply to it to finish the connection check."
          : result.delivery?.state === "uncertain"
            ? "Delivery is uncertain. Review its status before trying again."
            : result.state === "sending_enabled"
              ? "Sending enabled for tested senders."
              : result.state === "verified_for_test"
                ? "Existing domain connected. Create a sender below, then send a test."
                : "Saved. Status refreshed.",
      );
      await refresh();
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.operations} aria-label="Production setup">
      <h3>Connect and test</h3>
      {error && <p role="alert">{error.replaceAll("_", " ")}</p>}
      {status && <p role="status">{status}</p>}
      {!data ? (
        <button
          disabled={busy}
          onClick={() => refresh().catch((e) => setError(e.message))}
        >
          Retry setup status
        </button>
      ) : (
        <>
          <p>
            {data.readiness.sendingEnabled
              ? "Sending is enabled."
              : "Campaign sending is off until the connection checks pass."}
          </p>
          {data.readiness.blockers.length > 0 && (
            <ul>
              {data.readiness.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void act({
                action: "import_domain",
                domain: domain.trim().toLowerCase(),
              });
            }}
          >
            <label>
              Domain already verified in Resend
              <input
                value={domain}
                placeholder="talktosavingkc.com"
                onChange={(e) => setDomain(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <button disabled={busy || !domain.trim()}>
              Connect existing domain
            </button>
          </form>
          <div className={styles.form}>
            <label>
              Test sender
              <select
                value={sender}
                disabled={busy}
                onChange={(e) => {
                  setSender(e.target.value);
                  testKey.current = null;
                }}
              >
                <option value="">Choose a sender</option>
                {data.domains.senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.from_name} · {s.local_part}@
                    {data.domains.domains.find((d) => d.id === s.domain_id)
                      ?.name ?? "unknown"}
                  </option>
                ))}
              </select>
            </label>
            <p>
              One test email to{" "}
              {data.testRecipient ?? "the approved test address"}. No automatic
              test follow-up.
            </p>
            <button
              className={styles.primary}
              disabled={busy || !sender || !data.testRecipient}
              onClick={() => {
                testKey.current ??= crypto.randomUUID();
                void act({
                  action: "send_test",
                  senderId: sender,
                  idempotencyKey: testKey.current,
                });
              }}
            >
              Send controlled test
            </button>
            <button
              disabled={busy}
              onClick={() => act({ action: "process_replies" })}
            >
              Check replies and delivery
            </button>
            <button
              disabled={
                busy || !data.readiness.ready || data.readiness.sendingEnabled
              }
              onClick={() =>
                act({
                  action: "enable_sending",
                  expectedRevision: data.readiness.revision,
                })
              }
            >
              Enable tested senders
            </button>
          </div>
        </>
      )}
    </section>
  );
}
