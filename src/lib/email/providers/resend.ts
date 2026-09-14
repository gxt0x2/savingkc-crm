import { z } from "zod";

export type ProviderResult = {
  data?: { id?: string } | null;
  error?: { message: string } | null;
};
export function classifyResendResult(result: ProviderResult, timedOut = false) {
  if (timedOut) return { state: "uncertain" as const };
  if (result.error || !result.data?.id)
    return {
      state: "rejected" as const,
      error: result.error?.message ?? "missing_provider_id",
    };
  return { state: "accepted" as const, providerId: result.data.id };
}
export function canRetryProviderIntent(
  firstAttempt: Date,
  now: Date,
  state: "rejected" | "uncertain",
) {
  const elapsed = now.getTime() - firstAttempt.getTime();
  return state === "rejected" && elapsed >= 0 && elapsed < 86_400_000;
}

const payloadSchema = z
  .object({
    from: z
      .string()
      .min(3)
      .max(320)
      .refine((v) => !/[\r\n]/.test(v)),
    to: z.array(z.string().email()).length(1),
    subject: z
      .string()
      .min(1)
      .max(998)
      .refine((v) => !/[\r\n]/.test(v)),
    text: z.string().min(1).max(100_000),
    html: z.string().min(1).max(1_000_000).optional(),
    reply_to: z.string().email(),
    headers: z.record(
      z.string(),
      z.string().refine((v) => !/[\r\n]/.test(v)),
    ),
  })
  .strict();
export type FrozenResendPayload = z.infer<typeof payloadSchema>;
export type SendOutcome =
  | { state: "accepted"; providerId: string }
  | { state: "rejected"; code: string; retryable: boolean }
  | { state: "uncertain"; code: string };

/** No automatic retries: the durable ledger owns retry and reconciliation. */
export async function sendResendEmail(
  secret: string,
  payload: FrozenResendPayload,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<SendOutcome> {
  if (
    !payloadSchema.safeParse(payload).success ||
    !/^[A-Za-z0-9_:/-]{1,256}$/.test(idempotencyKey) ||
    !secret
  )
    return { state: "rejected", code: "INVALID_SEND_INPUT", retryable: false };
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      // A timeout/conflict/server failure may have accepted the original request.
      if (response.status >= 500 || [408, 409].includes(response.status))
        return { state: "uncertain", code: `RESEND_HTTP_${response.status}` };
      return {
        state: "rejected",
        code: `RESEND_HTTP_${response.status}`,
        retryable: response.status === 429,
      };
    }
    const reader = response.body?.getReader();
    if (!reader) return { state: "uncertain", code: "RESEND_INVALID_RESPONSE" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          return { state: "uncertain", code: "RESEND_INVALID_RESPONSE" };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const parsed = z
      .object({ id: z.string().uuid() })
      .safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return parsed.success
      ? { state: "accepted", providerId: parsed.data.id }
      : { state: "uncertain", code: "RESEND_INVALID_RESPONSE" };
  } catch {
    // Never expose provider errors, credentials or recipient/message contents.
    return { state: "uncertain", code: "RESEND_REQUEST_UNCERTAIN" };
  }
}
