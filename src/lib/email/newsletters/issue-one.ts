import {
  GENERAL_STORY_PLACEHOLDER,
  INHERITED_STORY_PLACEHOLDER,
  INVESTOR_STORY_PLACEHOLDER,
  NEWSLETTER_CALL_URL,
  NEWSLETTER_COMPANY_PHONE,
  NEWSLETTER_FROM_MAILBOX,
  NEWSLETTER_FROM_NAME,
  NEWSLETTER_LICENSE_LINE,
  TAX_STORY_PLACEHOLDER,
  newsletterEditionForSegment,
  newsletterProgramForSegment,
  type NewsletterEditionKey,
  type NewsletterSegment,
} from './constants'
import { decideHostedFrom, hostedUnsubscribeTargets } from '../providers/hosted-policy'

const POSTAL = 'Saving KC Homebuyers, 1705 Baltimore Ave, Kansas City, MO 64108'

const CALL_HTML = `<p style="margin:0 0 9px"><a href="${NEWSLETTER_CALL_URL}" style="color:#C8102E;font-weight:bold">Book a quick call with me at savingkc.com/call</a></p>`
const CALL_TEXT = `Book a quick call with me at ${NEWSLETTER_CALL_URL}`

export type RenderedNewsletter = {
  segment: NewsletterSegment
  edition: NewsletterEditionKey
  issue: 1
  program: 'seller_nurture' | 'buyer_marketing'
  fromName: string
  fromMailbox: string
  subject: string
  preview: string
  html: string
  text: string
  headers: { 'List-Unsubscribe': string; 'List-Unsubscribe-Post': string }
  unsubscribeUrl: string
}

type IssueCopy = {
  segment: NewsletterSegment
  title: string
  subject: string
  preview: string
  greeting: string
  intro: string
  story: string
  bodyHtml: string
  bodyText: string
  reason: string
}

function signOffHtml(closing: string) {
  return `<p style="margin:0 0 9px">${closing}<br><b>Ernest Dodson</b><br>Acquisitions Analyst, Saving KC Homebuyers<br>${NEWSLETTER_COMPANY_PHONE}</p>`
}

function signOffText(closing: string) {
  return `${closing}
Ernest Dodson
Acquisitions Analyst, Saving KC Homebuyers
${NEWSLETTER_COMPANY_PHONE}`
}

const general = {
  segment: 'general',
  title: 'The Tuesday Note #1',
  subject: 'The Tuesday Note #1: You do not have to decide today',
  preview: 'Looking at the house is not the same as picking a moving day.',
  greeting: 'Hi {{first_name}},',
  intro:
    "Ernest here. Since this is the first one, a quick hello: I'm a Kansas City local, married to T'Era, and dad to Maddi. I talk with homeowners who are weighing a sale and are not sure they want one.",
  story: GENERAL_STORY_PLACEHOLDER,
  bodyHtml: `<p style="margin:0 0 9px">It feels like looking at the house means you already have to pick a moving day.</p>
<p style="margin:0 0 9px">You don't. Here is the one move for this week. Call your lender and ask for the mortgage payoff. Then look up what you still owe the county in property taxes. Write both numbers down. A sale price is just a sale price until you know what has to come out of it. <b>The gap is what you would actually walk away with.</b></p>
<p style="margin:0 0 9px">What would have to be true for selling to feel like a relief instead of a rush?</p>
<p style="margin:0 0 9px">If you want, I'll sit with those two numbers and walk the options, including staying put. No pressure, and nothing to clean up before we talk.</p>
${CALL_HTML}
${signOffHtml('Rooting for you,')}
<p style="margin:0 0 9px"><i>P.S. Next week: which repairs change a Kansas City offer, and which ones buyers stop asking about.</i></p>`,
  bodyText: `It feels like looking at the house means you already have to pick a moving day.

You don't. Here is the one move for this week. Call your lender and ask for the mortgage payoff. Then look up what you still owe the county in property taxes. Write both numbers down. A sale price is just a sale price until you know what has to come out of it. The gap is what you would actually walk away with.

What would have to be true for selling to feel like a relief instead of a rush?

If you want, I'll sit with those two numbers and walk the options, including staying put. No pressure, and nothing to clean up before we talk.

${CALL_TEXT}

${signOffText('Rooting for you,')}

P.S. Next week: which repairs change a Kansas City offer, and which ones buyers stop asking about.`,
  reason: 'You got this because you asked Saving KC Homebuyers about selling your house.',
} satisfies IssueCopy

const tax = {
  segment: 'tax',
  title: 'The Tuesday Note #1',
  subject: 'The Tuesday Note #1: The bill on the counter',
  preview: 'Behind on the taxes is not the same thing as out of options.',
  greeting: 'Hi {{first_name}},',
  intro:
    'Ernest here. A lot of my conversations with homeowners start with a property tax bill they have been afraid to open.',
  story: TAX_STORY_PLACEHOLDER,
  bodyHtml: `<p style="margin:0 0 9px">It feels like the county already decided what happens to the house.</p>
<p style="margin:0 0 9px"><b>Behind is not the same as out of options.</b> Do this today, and it is free. Call the collector and write down three facts: the payoff, whether a sale date is already set, and whether a sale already happened.</p>
<p style="margin:0 0 9px">In most Missouri counties, state law puts delinquent land on the collector's sale on the fourth Monday in August, and you can pay the collector before that sale. Jackson County works differently. A parcel that is three years behind can be sued for foreclosure, and the court sale is generally held in August, only after a judgment. You can still pay the taxes, penalties, and suit costs before the sale. After a judgment, the county may offer a payment contract. The August 2026 Jackson County sale was canceled. If Jackson County is your county, call Collections at (816) 881-3232. Kansas counties use their own calendar. The date on your notice is the one that counts.</p>
<p style="margin:0 0 9px">What would have to be true for you to feel like you still have a choice?</p>
<p style="margin:0 0 9px">I'll walk that timing with you and lay out the options in plain English: pay it, a payment contract if your county offers one, or sell and clear the taxes at closing. If a sale already happened, we look at whether a redemption path is still open. No pressure.</p>
${CALL_HTML}
${signOffHtml('Rooting for you,')}
<p style="margin:0 0 9px"><i>P.S. Next week: the value on your tax bill is the county's guess, and the free way to push back before the next reassessment.</i></p>`,
  bodyText: `It feels like the county already decided what happens to the house.

Behind is not the same as out of options. Do this today, and it is free. Call the collector and write down three facts: the payoff, whether a sale date is already set, and whether a sale already happened.

In most Missouri counties, state law puts delinquent land on the collector's sale on the fourth Monday in August, and you can pay the collector before that sale. Jackson County works differently. A parcel that is three years behind can be sued for foreclosure, and the court sale is generally held in August, only after a judgment. You can still pay the taxes, penalties, and suit costs before the sale. After a judgment, the county may offer a payment contract. The August 2026 Jackson County sale was canceled. If Jackson County is your county, call Collections at (816) 881-3232. Kansas counties use their own calendar. The date on your notice is the one that counts.

What would have to be true for you to feel like you still have a choice?

I'll walk that timing with you and lay out the options in plain English: pay it, a payment contract if your county offers one, or sell and clear the taxes at closing. If a sale already happened, we look at whether a redemption path is still open. No pressure.

${CALL_TEXT}

${signOffText('Rooting for you,')}

P.S. Next week: the value on your tax bill is the county's guess, and the free way to push back before the next reassessment.`,
  reason: 'You got this because you asked Saving KC Homebuyers about property taxes on your house.',
} satisfies IssueCopy

const inherited = {
  segment: 'inherited',
  title: 'The Tuesday Note #1',
  subject: 'The Tuesday Note #1: A house you did not ask for',
  preview: 'The keys landed with you. You do not have to empty the house to get clarity.',
  greeting: 'Hi {{first_name}},',
  intro:
    'Ernest here. Some of the hardest houses I see belong to someone who never planned to own them.',
  story: INHERITED_STORY_PLACEHOLDER,
  bodyHtml: `<p style="margin:0 0 9px">It feels like everyone else has an opinion, and you are the one holding the keys.</p>
<p style="margin:0 0 9px">Before you rent a dumpster, write down three facts. Whether a court has opened the estate. Who is allowed to sign for the house. Whether a mortgage or a tax bill is still attached. <b>Those three decide the next step.</b> A clean room does not. I'm not your lawyer. If the estate is in court, the personal representative gets authority from the judge, not from a family group text.</p>
<p style="margin:0 0 9px">What would feel like a relief: keeping it, selling it, or just a clear list of what has to happen first?</p>
<p style="margin:0 0 9px">I'll help you separate the house from the probate and clean-out stress. You do not have to empty it before we talk.</p>
${CALL_HTML}
${signOffHtml('Rooting for you,')}
<p style="margin:0 0 9px"><i>P.S. Next week: what to do with the stuff in the house when you are not ready to decide on the house itself.</i></p>`,
  bodyText: `It feels like everyone else has an opinion, and you are the one holding the keys.

Before you rent a dumpster, write down three facts. Whether a court has opened the estate. Who is allowed to sign for the house. Whether a mortgage or a tax bill is still attached. Those three decide the next step. A clean room does not. I'm not your lawyer. If the estate is in court, the personal representative gets authority from the judge, not from a family group text.

What would feel like a relief: keeping it, selling it, or just a clear list of what has to happen first?

I'll help you separate the house from the probate and clean-out stress. You do not have to empty it before we talk.

${CALL_TEXT}

${signOffText('Rooting for you,')}

P.S. Next week: what to do with the stuff in the house when you are not ready to decide on the house itself.`,
  reason: 'You got this because you asked Saving KC Homebuyers about a house you inherited.',
} satisfies IssueCopy

const investor = {
  segment: 'investor',
  title: 'The Tuesday Deal Desk #1',
  subject: 'The Tuesday Deal Desk #1: The number that moved this week',
  preview: 'Same loan, same house, less cash flow than a year ago. Here is the math.',
  greeting: 'Hey {{first_name}},',
  intro:
    "Ernest here. This is the first Deal Desk, so a quick intro: I'm a Kansas City local and an Acquisitions Analyst at Saving KC Homebuyers. My job is running the numbers on a house before anybody falls in love with the kitchen.",
  story: INVESTOR_STORY_PLACEHOLDER,
  bodyHtml: `<p style="margin:0 0 9px">It feels like the same house got more expensive without the rent changing.</p>
<p style="margin:0 0 9px">One number moved this week. Freddie Mac's 30-year average hit 7.40% on Oct 8. A year ago, it was 6.30%. On a $200,000 loan, that's about $1,385 a month instead of $1,238, principal and interest only. About $147 more every month. Roughly $1,760 a year.</p>
<p style="margin:0 0 9px">Same house. Same rent. Less cash flow.</p>
<p style="margin:0 0 9px"><b>You make your money when you buy.</b> You can't control the rate. You can control the price you pay.</p>
<p style="margin:0 0 9px">If the rate is outside your control, what price would make the next house work?</p>
<p style="margin:0 0 9px">When a Kansas City house crosses my desk and the numbers work, the people who have told me their area and price range get first look. Bring both to a short call.</p>
${CALL_HTML}
${signOffHtml('Buy right,')}
<p style="margin:0 0 9px"><i>P.S. Next week: what I am watching around the Royals stadium talk near Crown Center.</i></p>`,
  bodyText: `It feels like the same house got more expensive without the rent changing.

One number moved this week. Freddie Mac's 30-year average hit 7.40% on Oct 8. A year ago, it was 6.30%. On a $200,000 loan, that's about $1,385 a month instead of $1,238, principal and interest only. About $147 more every month. Roughly $1,760 a year.

Same house. Same rent. Less cash flow.

You make your money when you buy. You can't control the rate. You can control the price you pay.

If the rate is outside your control, what price would make the next house work?

When a Kansas City house crosses my desk and the numbers work, the people who have told me their area and price range get first look. Bring both to a short call.

${CALL_TEXT}

${signOffText('Buy right,')}

P.S. Next week: what I am watching around the Royals stadium talk near Crown Center.`,
  reason: 'You got this because you joined the Saving KC Homebuyers buyer list.',
} satisfies IssueCopy

const ISSUES: Record<NewsletterSegment, IssueCopy> = {
  general,
  tax,
  inherited,
  investor,
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char
  ))
}

function footerHtml(reason: string, unsubscribeUrl: string) {
  const link = `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#71717a">Unsubscribe</a>`
  return `<div style="border-top:1px solid #d4d4d8;margin-top:12px;padding-top:8px;font-size:11px;line-height:1.5;color:#71717a">${escapeHtml(reason)} ${escapeHtml(POSTAL)}. ${link} anytime, no hard feelings.<br>${escapeHtml(NEWSLETTER_LICENSE_LINE)} Company phone ${escapeHtml(NEWSLETTER_COMPANY_PHONE)}.</div>`
}

function messageHtml(copy: IssueCopy, unsubscribeUrl: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.title)}</title></head>
<body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111">
<div style="max-width:600px;margin:0 auto;padding:10px 18px">
<div style="font-size:15px;line-height:1.5">
<p style="margin:0 0 9px">${escapeHtml(copy.greeting)}</p>
<p style="margin:0 0 9px">${escapeHtml(copy.intro)}</p>
<p style="margin:0 0 9px;background:#f4f4f5;border-left:3px solid #71717a;padding:6px 10px;font-size:14px;color:#3f3f46"><b>${escapeHtml(copy.story)}</b></p>
${copy.bodyHtml}
</div>
${footerHtml(copy.reason, unsubscribeUrl)}
</div></body></html>`
}

function messageText(copy: IssueCopy, unsubscribeUrl: string) {
  return `${copy.greeting}

${copy.intro}

${copy.story}

${copy.bodyText}

${copy.reason} ${POSTAL}. Unsubscribe anytime, no hard feelings.
Unsubscribe: ${unsubscribeUrl}
${NEWSLETTER_LICENSE_LINE} Company phone ${NEWSLETTER_COMPANY_PHONE}.`
}

export function renderNewsletterIssue(
  segment: NewsletterSegment,
  options?: { origin?: string; token?: string },
): RenderedNewsletter {
  const copy = ISSUES[segment]
  const program = newsletterProgramForSegment(segment)
  const from = decideHostedFrom({
    localPart: 'ernest',
    domain: 'talktosavingkc.com',
    program,
    fromName: NEWSLETTER_FROM_NAME,
  })
  if (!from.ok || from.mailbox !== NEWSLETTER_FROM_MAILBOX) {
    throw new Error('NEWSLETTER_FROM_REJECTED')
  }
  const origin = options?.origin ?? 'https://preview.talktosavingkc.com'
  const token = options?.token ?? `1.${'n'.repeat(43)}`
  const targets = hostedUnsubscribeTargets(origin, token)
  const html = messageHtml(copy, targets.link)
  return {
    segment,
    edition: newsletterEditionForSegment(segment),
    issue: 1,
    program,
    fromName: NEWSLETTER_FROM_NAME,
    fromMailbox: from.mailbox,
    subject: copy.subject,
    preview: copy.preview,
    html,
    text: messageText(copy, targets.link),
    headers: {
      'List-Unsubscribe': targets.headers['List-Unsubscribe'],
      'List-Unsubscribe-Post': targets.headers['List-Unsubscribe-Post'],
    },
    unsubscribeUrl: targets.link,
  }
}

/** Internal preview document. The inbox card is not part of the sendable body. */
export function renderNewsletterPreview(segment: NewsletterSegment) {
  const issue = renderNewsletterIssue(segment)
  const headerBlock = `<div style="background:#f4f4f5;border:1px solid #d4d4d8;border-radius:6px;padding:8px 12px;font-size:13px;line-height:1.5;color:#3f3f46;margin:0 0 14px"><span style="font-size:11px;color:#71717a">INBOX PREVIEW &middot; </span><b>From:</b> ${escapeHtml(issue.fromName)} &lt;${escapeHtml(issue.fromMailbox)}&gt;<br><b>Subject:</b> ${escapeHtml(issue.subject)}<br><b>Preview:</b> ${escapeHtml(issue.preview)}<br><b>List-Unsubscribe:</b> ${escapeHtml(issue.headers['List-Unsubscribe'])}<br><b>List-Unsubscribe-Post:</b> ${escapeHtml(issue.headers['List-Unsubscribe-Post'])}</div>`
  const html = issue.html.replace(
    '<div style="font-size:15px;line-height:1.5">',
    `${headerBlock}<div style="font-size:15px;line-height:1.5">`,
  )
  return { ...issue, html }
}
