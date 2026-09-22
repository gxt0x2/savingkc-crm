import { parse } from "tldts";
import { normalizeEmailDomain } from "./resend-domains";

/** Counsel-v3 Tax / seller-outreach From. Never a savingkc.com mailbox. */
export const TAX_OUTREACH_FROM = "ari@talktosavingkc.com";
const FORBIDDEN_REGISTRABLE_DOMAIN = "savingkc.com";

export type HostedFromDecision =
  | { ok: true; mailbox: string }
  | {
      ok: false;
      code:
        | "FROM_DOMAIN_FORBIDDEN"
        | "TAX_FROM_REQUIRED"
        | "HOSTED_FROM_INVALID";
    };

function registrableDomain(domain: string) {
  return parse(domain, { allowPrivateDomains: false }).domain;
}

function mentionsForbiddenDomain(value: string) {
  const tokens = value.match(/[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return tokens.some((token) => {
    const host = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, "").toLowerCase();
    if (!host) return false;
    try {
      return (
        registrableDomain(normalizeEmailDomain(host)) ===
        FORBIDDEN_REGISTRABLE_DOMAIN
      );
    } catch {
      return (
        host === FORBIDDEN_REGISTRABLE_DOMAIN ||
        host.endsWith(`.${FORBIDDEN_REGISTRABLE_DOMAIN}`)
      );
    }
  });
}

/**
 * Fail closed before a hosted Resend payload is frozen.
 * Every program rejects the savingkc.com registrable domain (apex and subdomains).
 * seller_outreach, the Tax path, accepts only ari@talktosavingkc.com.
 * Other programs may use a different independent mailbox.
 */
export function decideHostedFrom(input: {
  localPart: string;
  domain: string;
  program: string;
  fromName?: string;
}): HostedFromDecision {
  const localPart = input.localPart.trim().toLowerCase();
  let domain: string;
  try {
    domain = normalizeEmailDomain(input.domain);
  } catch {
    return { ok: false, code: "HOSTED_FROM_INVALID" };
  }
  if (
    registrableDomain(domain) === FORBIDDEN_REGISTRABLE_DOMAIN ||
    (input.fromName ? mentionsForbiddenDomain(input.fromName) : false)
  ) {
    return { ok: false, code: "FROM_DOMAIN_FORBIDDEN" };
  }
  if (!localPart || /[\s@<>]/.test(localPart)) {
    return { ok: false, code: "HOSTED_FROM_INVALID" };
  }
  const mailbox = `${localPart}@${domain}`;
  if (input.program.trim() === "seller_outreach" && mailbox !== TAX_OUTREACH_FROM) {
    return { ok: false, code: "TAX_FROM_REQUIRED" };
  }
  return { ok: true, mailbox };
}

/** Human preference link plus machine one-click headers. The token stays out of the text body. */
export function hostedUnsubscribeTargets(origin: string, token: string) {
  return {
    link: `${origin}/email/unsubscribe/${token}`,
    headers: {
      "List-Unsubscribe": `<${origin}/api/email/unsubscribe/${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
