import {
  NEWSLETTER_BRAND,
  NEWSLETTER_COMPANY_PHONE,
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_COUNTIES,
  NEWSLETTER_LICENSE_LINE,
} from './constants'

/** Static preview of the public signup form. Nothing is submitted from this file. */
export function renderSignupFormPreview() {
  const counties = NEWSLETTER_COUNTIES.map(
    (county) => `<option value="${county}">${county}</option>`,
  ).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tuesday newsletter signup</title></head>
<body style="margin:0;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif">
<main style="max-width:640px;margin:0 auto;padding:28px 18px">
<p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#71717a">${NEWSLETTER_BRAND}</p>
<h1 style="margin:8px 0 8px;font-size:28px;line-height:1.2">The Tuesday newsletters</h1>
<p style="margin:0 0 18px;font-size:16px;line-height:1.5">One short note each Tuesday from Ernest. Sellers get The Tuesday Note. Buyers and investors get The Tuesday Deal Desk.</p>
<form action="/api/email/newsletters/signup" method="post" style="border:1px solid #d4d4d8;border-radius:8px;padding:16px">
<label style="display:block;font-size:14px;font-weight:700;margin:0 0 6px" for="email">Email</label>
<input id="email" name="email" type="email" required style="width:100%;box-sizing:border-box;border:1px solid #d4d4d8;border-radius:6px;padding:10px;font:inherit">
<fieldset style="border:0;padding:12px 0 0;margin:0">
<legend style="font-size:14px;font-weight:700">I am a</legend>
<label style="display:block;margin-top:8px"><input type="radio" name="role" value="seller" required> Seller</label>
<label style="display:block;margin-top:8px"><input type="radio" name="role" value="buyer"> Buyer or investor</label>
</fieldset>
<label style="display:block;font-size:14px;font-weight:700;margin:12px 0 6px" for="county">County</label>
<select id="county" name="county" required style="width:100%;box-sizing:border-box;border:1px solid #d4d4d8;border-radius:6px;padding:10px;font:inherit">
<option value="">Choose a county</option>
${counties}
</select>
<label style="display:block;margin-top:14px;font-size:14px;line-height:1.4"><input type="checkbox" name="consent" value="true" required> ${NEWSLETTER_CONSENT_TEXT}</label>
<button type="submit" style="margin-top:16px;background:#C8102E;color:#ffffff;border:0;border-radius:6px;padding:10px 14px;font-family:inherit;font-weight:700">Send me the Tuesday note</button>
</form>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#71717a">${NEWSLETTER_LICENSE_LINE} Company phone ${NEWSLETTER_COMPANY_PHONE}.</p>
</main></body></html>`
}
