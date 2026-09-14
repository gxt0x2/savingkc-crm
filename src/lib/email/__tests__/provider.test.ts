import { describe, expect, it } from "vitest";
import {
  canRetryProviderIntent,
  classifyResendResult,
} from "../providers/resend";
describe("resend result handling", () => {
  it("does not call a resolved promise success without a provider id", () => {
    expect(classifyResendResult({ data: {} }).state).toBe("rejected");
    expect(classifyResendResult({ data: { id: "email-1" } })).toEqual({
      state: "accepted",
      providerId: "email-1",
    });
  });
  it("keeps timeout uncertain and does not retry it", () => {
    expect(classifyResendResult({}, true).state).toBe("uncertain");
    expect(canRetryProviderIntent(new Date(), new Date(), "uncertain")).toBe(
      false,
    );
  });
});

import { vi } from "vitest";
import { sendResendEmail } from "../providers/resend";
const payload = {
  from: "SavingKC <hello@example.test>",
  to: ["owner@example.test"],
  subject: "Controlled test",
  text: "Test message",
  reply_to: "reply@example.test",
  headers: {},
};
describe("real Resend transport", () => {
  it("uses the frozen payload and stable key exactly once", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id }));
    expect(
      await sendResendEmail(
        "fixture-secret",
        payload,
        "email:intent:1",
        fetcher,
      ),
    ).toEqual({ state: "accepted", providerId: id });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].body).toBe(JSON.stringify(payload));
    expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
      "email:intent:1",
    );
  });
  it.each([408, 409, 500, 503])(
    "holds HTTP %s as uncertain without retry",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
      expect(
        (await sendResendEmail("fixture-secret", payload, "intent:1", fetcher))
          .state,
      ).toBe("uncertain");
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("preserves uncertainty on connection loss and malformed success", async () => {
    for (const fetcher of [
      vi.fn().mockRejectedValue(new Error("private")),
      vi.fn().mockResolvedValue(Response.json({})),
    ]) {
      expect(
        (await sendResendEmail("fixture-secret", payload, "intent:1", fetcher))
          .state,
      ).toBe("uncertain");
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("rejects multiple recipients before any remote request", async () => {
    const fetcher = vi.fn();
    expect(
      await sendResendEmail(
        "fixture-secret",
        { ...payload, to: ["a@example.test", "b@example.test"] },
        "intent:1",
        fetcher,
      ),
    ).toEqual({
      state: "rejected",
      code: "INVALID_SEND_INPUT",
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("permits rate-limit retry only on the existing ledger intent", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 429 }));
    expect(
      await sendResendEmail("fixture-secret", payload, "intent:1", fetcher),
    ).toEqual({ state: "rejected", code: "RESEND_HTTP_429", retryable: true });
    expect(
      canRetryProviderIntent(new Date(0), new Date(86400000), "rejected"),
    ).toBe(false);
  });
});
