const optOutLead = `If you'd rather I not email you again, tap `;
const optOutTail = ` and I'll take you off today.`;
const optOut = `${optOutLead}Unsubscribe${optOutTail}`;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const postalAddress = (address: string) =>
  address.trim().replace(/,\s*(Kansas City,?\s*MO\s*64108)/i, "\n$1");

/** Signature display only. Workspace config may still store the legal LLC name. */
function signatureBusinessName(businessName: string) {
  const display = businessName
    .trim()
    .replace(/(?:,\s*|\s+)L\.?\s*L\.?\s*C\.?$/i, "")
    .trim();
  return display || businessName.trim();
}

/**
 * Solid rule between the signature and Unsubscribe.
 * A CSS-only hr (border:0 plus a 1px gray border-top) disappears in Outlook
 * and is faint elsewhere. bgcolor on a fixed-height cell renders in
 * Gmail, Apple Mail, and Outlook.
 */
const signatureRule =
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:22px 0;font-size:2px;line-height:2px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="2" bgcolor="#333333" style="height:2px;background-color:#333333;font-size:2px;line-height:2px;">&nbsp;</td></tr></table></td></tr></table>';

function requireUnsubscribeUrl(unsubscribeUrl: string) {
  if (!unsubscribeUrl.trim()) throw new Error("UNSUBSCRIBE_URL_REQUIRED");
}

export function outreachFooter(
  businessName: string,
  address: string,
  unsubscribeUrl: string,
) {
  requireUnsubscribeUrl(unsubscribeUrl);
  return `Best regards,\n\nAri\n${signatureBusinessName(businessName)}\n${postalAddress(address)}\n\n———\n\n${optOut}`;
}

/** Minimal email HTML; all message and workspace content is escaped. The Unsubscribe word is the only visible opt-out link. */
export function outreachHtml(
  body: string,
  businessName: string,
  address: string,
  unsubscribeUrl: string,
) {
  requireUnsubscribeUrl(unsubscribeUrl);
  const lines = (text: string) => escapeHtml(text).replace(/\r?\n/g, "<br>");
  const unsubscribe = `<a href="${escapeHtml(unsubscribeUrl)}" style="color:inherit;text-decoration:underline">Unsubscribe</a>`;
  return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.4"><div>${lines(body)}</div><p style="margin:20px 0 12px"><strong>Best regards,</strong></p><p style="margin:0"><strong>Ari</strong><br>${lines(signatureBusinessName(businessName))}<br>${lines(postalAddress(address))}</p>${signatureRule}<p style="margin:0">${escapeHtml(optOutLead)}${unsubscribe}${escapeHtml(optOutTail)}</p></div>`;
}
