const optOut = `If you'd rather I not email you again, just reply "remove" and I'll take you off the list today.`
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const postalAddress = (address: string) => address.trim().replace(/,\s*(Kansas City,?\s*MO\s*64108)/i, '\n$1')

export function outreachFooter(businessName: string, address: string, unsubscribeUrl: string) {
  return `Best regards,\n\nAri\n${businessName}\n${postalAddress(address)}\n\n———\n\n${optOut}\nUnsubscribe: ${unsubscribeUrl}`
}

/** Minimal email HTML; all message and workspace content is escaped. */
export function outreachHtml(body: string, businessName: string, address: string, unsubscribeUrl: string) {
  const lines = (text: string) => escapeHtml(text).replace(/\r?\n/g, '<br>')
  return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.4"><div>${lines(body)}</div><p style="margin:20px 0 12px"><strong>Best regards,</strong></p><p style="margin:0"><strong>Ari</strong><br>${lines(businessName)}<br>${lines(postalAddress(address))}</p><hr style="border:0;border-top:1px solid #b5b5b5;margin:22px 0"><p style="margin:0">${escapeHtml(optOut).replace('&quot;remove&quot;', `&quot;<a href="${escapeHtml(unsubscribeUrl)}" style="color:inherit;text-decoration:underline" aria-label="Unsubscribe from marketing emails">remove</a>&quot;`)}</p></div>`
}
