import { describe, expect, it } from "vitest";
import {
  decideHostedFrom,
  hostedUnsubscribeTargets,
  TAX_OUTREACH_FROM,
} from "../providers/hosted-policy";
import { outreachFooter, outreachHtml } from "../providers/outreach-footer";

const token = "1.abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
const origin = "https://crm.example.test";

describe("hosted unsubscribe targets", () => {
  it("keeps one-click headers and a separate human preference link", () => {
    const targets = hostedUnsubscribeTargets(origin, token);
    expect(targets.headers["List-Unsubscribe"]).toBe(
      `<${origin}/api/email/unsubscribe/${token}>`,
    );
    expect(targets.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
    expect(targets.link).toBe(`${origin}/email/unsubscribe/${token}`);
    const text = outreachFooter(
      "Saving KC Homebuyers LLC",
      "1705 Baltimore Ave, Kansas City, MO 64108",
      targets.link,
    );
    const html = outreachHtml(
      "Hi Pat",
      "Saving KC Homebuyers LLC",
      "1705 Baltimore Ave, Kansas City, MO 64108",
      targets.link,
    );
    expect(text).not.toContain(targets.link);
    expect(text).not.toContain(token);
    expect(html).toContain(`href="${targets.link}"`);
    expect(html).toContain(">Unsubscribe</a>");
    expect(html.replace(`href="${targets.link}"`, 'href=""')).not.toContain(
      targets.link,
    );
  });
});

describe("hosted tax from", () => {
  it("accepts only ari@talktosavingkc.com for seller outreach", () => {
    expect(
      decideHostedFrom({
        localPart: "Ari",
        domain: "TalkToSavingKC.com",
        program: "seller_outreach",
        fromName: "Ari",
      }),
    ).toEqual({ ok: true, mailbox: TAX_OUTREACH_FROM });
    expect(
      decideHostedFrom({
        localPart: "hello",
        domain: "talktosavingkc.com",
        program: "seller_outreach",
        fromName: "Ari",
      }),
    ).toEqual({ ok: false, code: "TAX_FROM_REQUIRED" });
  });

  it("rejects the savingkc.com registrable domain on every hosted program", () => {
    for (const program of [
      "seller_outreach",
      "seller_nurture",
      "buyer_marketing",
    ]) {
      expect(
        decideHostedFrom({
          localPart: "ernest",
          domain: "savingkc.com",
          program,
          fromName: "Ernest",
        }),
      ).toEqual({ ok: false, code: "FROM_DOMAIN_FORBIDDEN" });
      expect(
        decideHostedFrom({
          localPart: "ari",
          domain: "mail.savingkc.com",
          program,
          fromName: "Ari",
        }),
      ).toEqual({ ok: false, code: "FROM_DOMAIN_FORBIDDEN" });
    }
  });

  it("does not treat talktosavingkc.com as savingkc.com and leaves other programs open", () => {
    expect(
      decideHostedFrom({
        localPart: "ari",
        domain: "talktosavingkc.com",
        program: "seller_outreach",
        fromName: "Saving KC Homebuyers",
      }).ok,
    ).toBe(true);
    expect(
      decideHostedFrom({
        localPart: "hello",
        domain: "outreach.example.com",
        program: "seller_nurture",
        fromName: "Saving KC",
      }),
    ).toEqual({ ok: true, mailbox: "hello@outreach.example.com" });
  });

  it("rejects a display name that smuggles a savingkc.com address", () => {
    expect(
      decideHostedFrom({
        localPart: "ari",
        domain: "talktosavingkc.com",
        program: "seller_outreach",
        fromName: "Ernest ernest@savingkc.com",
      }),
    ).toEqual({ ok: false, code: "FROM_DOMAIN_FORBIDDEN" });
  });
});
