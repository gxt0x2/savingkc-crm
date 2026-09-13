import "server-only";
import type { Sql } from "postgres";
import {
  preferenceTokenPattern,
  recordPreference,
  unsubscribeWithToken,
  type PreferenceKeys,
} from "./service";
import { emailPrograms } from "../contracts";
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
};
function page(content: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences · SavingKC</title><style>body{margin:0;background:#f5f6f8;color:#20252d;font:16px system-ui}main{max-width:440px;margin:12vh auto;padding:32px;background:white;border:1px solid #dde1e7;border-radius:12px}h1{font-size:24px}p,label{line-height:1.6}button{background:#b7192c;color:white;border:0;border-radius:7px;padding:12px 20px;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #20252d;outline-offset:3px}fieldset{border:0;padding:0;margin:16px 0}label{display:block;margin:8px 0}</style><main>${content}</main></html>`,
    { status, headers },
  );
}
function preferenceCenter(token: string) {
  const options = emailPrograms
    .map(
      (program) =>
        `<label><input type="radio" name="program" value="${program}" required> ${program.replaceAll("_", " ")}</label>`,
    )
    .join("");
  return `<h1>You’re unsubscribed</h1><p>Marketing emails to this address have been stopped. This cannot restart them.</p><form action="/api/email/unsubscribe/${token}" method="post"><input type="hidden" name="List-Unsubscribe" value="Preference"><fieldset><legend>Optionally record which program this request is about</legend>${options}</fieldset><button type="submit">Save program note</button></form>`;
}
export function preferenceConfirmation(token: string) {
  if (!preferenceTokenPattern.test(token))
    return page(
      "<h1>Check your email link</h1><p>Open the unsubscribe link in the original email.</p>",
      400,
    );
  // GET never changes preferences: automated link scanners cannot unsubscribe.
  return page(
    `<h1>Stop marketing emails</h1><p>Unsubscribe from SavingKC marketing emails sent to this address.</p><form action="/api/email/unsubscribe/${token}" method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe</button></form>`,
  );
}
export function createPreferencePost(
  database: () => Sql,
  keys?: PreferenceKeys,
) {
  return async (request: Request, token: string) => {
    if (!preferenceTokenPattern.test(token))
      return page(
        "<h1>Check your email link</h1><p>Open the unsubscribe link in the original email.</p>",
        400,
      );
    const type = request.headers.get("content-type")?.split(";")[0].trim();
    if (type !== "application/x-www-form-urlencoded")
      return page(
        "<h1>Request not accepted</h1><p>Use the unsubscribe button in your email.</p>",
        415,
      );
    // Bound streamed input, including chunked requests. No cookies or login.
    const reader = request.body?.getReader();
    let body = "";
    if (reader) {
      let size = 0;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          return page("<h1>Request too large</h1>", 413);
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    }
    const fields = new URLSearchParams(body);
    const action = fields.get("List-Unsubscribe");
    if (fields.getAll("List-Unsubscribe").length !== 1 || !action)
      return page(
        "<h1>Request not accepted</h1><p>Use the unsubscribe button in your email.</p>",
        400,
      );
    try {
      if (action === "Preference") {
        const program = fields.get("program") ?? "";
        const saved = await recordPreference(database(), token, program, keys);
        if (saved === "needs_unsubscribe")
          return page(
            "<h1>Stop marketing first</h1><p>Unsubscribe before recording a program note. This cannot restart email.</p>",
            409,
          );
        if (!saved)
          return page(
            "<h1>Check your email link</h1><p>Open the unsubscribe link in the original email.</p>",
            400,
          );
        return page(
          "<h1>Preference saved</h1><p>Marketing remains stopped. This note does not restart email.</p>",
        );
      }
      if (action !== "One-Click")
        return page(
          "<h1>Request not accepted</h1><p>Use the unsubscribe button in your email.</p>",
          400,
        );
      const found = await unsubscribeWithToken(database(), token, keys);
      if (!found)
        return page(
          "<h1>Check your email link</h1><p>Open the unsubscribe link in your original email.</p>",
          400,
        );
      return page(preferenceCenter(token));
    } catch {
      return page(
        "<h1>Please try again</h1><p>We could not save your request. Please retry the unsubscribe button.</p>",
        503,
      );
    }
  };
}
