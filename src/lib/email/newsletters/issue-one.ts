import {
  BUYER_STORY_PLACEHOLDER,
  NEWSLETTER_CALL_URL,
  NEWSLETTER_COMPANY_PHONE,
  NEWSLETTER_FROM_MAILBOX,
  NEWSLETTER_FROM_NAME,
  NEWSLETTER_LICENSE_LINE,
  SELLER_STORY_PLACEHOLDER,
  type NewsletterEditionKey,
} from './constants'
import { decideHostedFrom, hostedUnsubscribeTargets } from '../providers/hosted-policy'

const POSTAL = 'Saving KC Homebuyers LLC, 1705 Baltimore Ave, Kansas City, MO 64108'

export type RenderedNewsletter = {
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
  edition: NewsletterEditionKey
  program: 'seller_nurture' | 'buyer_marketing'
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

const seller = {
  edition: 'tuesday_note',
  program: 'seller_nurture',
  title: 'The Tuesday Note #1',
  subject: 'The Tuesday Note #1: The county made a guess about your house',
  preview: "It's a guess, not a final answer. Here's how to push back, for free.",
  greeting: 'Hi {{first_name}},',
  intro:
    "Ernest here. Since this is the first one, a quick hello: I'm a Kansas City local, married to T'Era, and dad to Maddi. At Saving KC Homebuyers, a lot of my conversations with homeowners start with a property tax bill.",
  story: SELLER_STORY_PLACEHOLDER,
  bodyHtml: `<p style="margin:0 0 9px">Here's the lesson: <b>the value on your tax bill is the county's guess. Not a final answer.</b> And you're allowed to tell them they guessed wrong. It's free.</p>
<p style="margin:0 0 9px">Missouri revalues homes in odd years, so Jackson County homes get a new number in 2027. Get ready now, while nobody's rushing. It takes about 10 minutes:</p>
<p style="margin:0 0 9px">1. Look up your current appraised value on the county website.<br>2. Take photos of anything that needs work (roof, foundation, old furnace) and keep any repair quotes.<br>3. Write down 3 nearby homes that sold for less than the county's number.</p>
<p style="margin:0 0 9px">When the 2027 notice shows up, call the Assessment office at (816) 881-4601 and ask for an informal review. If that doesn't fix it, you can appeal to the Board of Equalization. This year the deadline was the second Monday in July. One folder now, and the number you fix sticks around for two years.</p>
<p style="margin:0 0 9px">If your taxes are already behind and that folder feels like the least of your worries, I get it. Let's talk it through. No pressure. I'll walk you through your options in plain English.</p>
<p style="margin:0 0 9px"><a href="${NEWSLETTER_CALL_URL}" style="color:#C8102E;font-weight:bold">Book a quick call with me at savingkc.com/call</a>, or just hit reply.</p>
<p style="margin:0 0 9px">Rooting for you,<br><b>Ernest Dodson</b><br>Acquisitions Analyst, Saving KC Homebuyers<br>(816) 608-8588</p>
<p style="margin:0 0 9px"><i>P.S. Next week: if you're 62 or older and live in your Jackson County house, there's a program that can freeze part of your tax bill. Most people I talk to have never heard of it.</i></p>`,
  bodyText: `Here's the lesson: the value on your tax bill is the county's guess. Not a final answer. And you're allowed to tell them they guessed wrong. It's free.

Missouri revalues homes in odd years, so Jackson County homes get a new number in 2027. Get ready now, while nobody's rushing. It takes about 10 minutes:

1. Look up your current appraised value on the county website.
2. Take photos of anything that needs work (roof, foundation, old furnace) and keep any repair quotes.
3. Write down 3 nearby homes that sold for less than the county's number.

When the 2027 notice shows up, call the Assessment office at (816) 881-4601 and ask for an informal review. If that doesn't fix it, you can appeal to the Board of Equalization. This year the deadline was the second Monday in July. One folder now, and the number you fix sticks around for two years.

If your taxes are already behind and that folder feels like the least of your worries, I get it. Let's talk it through. No pressure. I'll walk you through your options in plain English.

Book a quick call with me at ${NEWSLETTER_CALL_URL}, or just hit reply.

Rooting for you,
Ernest Dodson
Acquisitions Analyst, Saving KC Homebuyers
(816) 608-8588

P.S. Next week: if you're 62 or older and live in your Jackson County house, there's a program that can freeze part of your tax bill. Most people I talk to have never heard of it.`,
  reason: 'You got this because you asked Saving KC Homebuyers about your house or our tax guide.',
} satisfies IssueCopy

const buyer = {
  edition: 'tuesday_deal_desk',
  program: 'buyer_marketing',
  title: 'The Tuesday Deal Desk #1',
  subject: 'The Tuesday Deal Desk #1: The number that moved this week',
  preview: "Same loan, same house, a lot less cash flow than a year ago. Here's the math.",
  greeting: 'Hey {{first_name}},',
  intro:
    "Ernest here. This is the first Deal Desk, so a quick intro: I'm a Kansas City local and an Acquisitions Analyst at Saving KC Homebuyers. My job is running the numbers on a house before anybody falls in love with the kitchen.",
  story: BUYER_STORY_PLACEHOLDER,
  bodyHtml: `<p style="margin:0 0 9px">One thing to know this week. <b>Rates went up again.</b> Freddie Mac's 30-year average hit 7.40% on Oct 8. A year ago, it was 6.30%.</p>
<p style="margin:0 0 9px">On a $200,000 loan, that's about $1,385 a month instead of $1,238 (principal and interest only). About $147 more every month. Roughly $1,760 a year.</p>
<p style="margin:0 0 9px">Same house. Same rent. Less cash flow.</p>
<p style="margin:0 0 9px">So here's the lesson, plain and simple: <b>you make your money when you buy.</b> You can't control the rate. You can control the price you pay.</p>
<p style="margin:0 0 9px">That's what our deal list is for. When a Kansas City house comes across my desk with numbers that work, the people on the list get first look.</p>
<p style="margin:0 0 9px"><span style="color:#C8102E;font-weight:bold">Want on it? Reply "LIST" with the area and price range you buy in.</span> I read every reply myself.</p>
<p style="margin:0 0 9px">Buy right,<br><b>Ernest Dodson</b><br>Acquisitions Analyst, Saving KC Homebuyers<br>(816) 608-8588</p>
<p style="margin:0 0 9px"><i>P.S. Next week: the Royals stadium plan around Crown Center, and what I'm watching for nearby houses. Lots of money is pointed at one part of town.</i></p>`,
  bodyText: `One thing to know this week. Rates went up again. Freddie Mac's 30-year average hit 7.40% on Oct 8. A year ago, it was 6.30%.

On a $200,000 loan, that's about $1,385 a month instead of $1,238 (principal and interest only). About $147 more every month. Roughly $1,760 a year.

Same house. Same rent. Less cash flow.

So here's the lesson, plain and simple: you make your money when you buy. You can't control the rate. You can control the price you pay.

That's what our deal list is for. When a Kansas City house comes across my desk with numbers that work, the people on the list get first look.

Want on it? Reply "LIST" with the area and price range you buy in. I read every reply myself.

Buy right,
Ernest Dodson
Acquisitions Analyst, Saving KC Homebuyers
(816) 608-8588

P.S. Next week: the Royals stadium plan around Crown Center, and what I'm watching for nearby houses. Lots of money is pointed at one part of town.`,
  reason: 'You got this because you joined the Saving KC Homebuyers buyers list.',
} satisfies IssueCopy

const ISSUES: Record<NewsletterEditionKey, IssueCopy> = {
  tuesday_note: seller,
  tuesday_deal_desk: buyer,
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
  edition: NewsletterEditionKey,
  options?: { origin?: string; token?: string },
): RenderedNewsletter {
  const copy = ISSUES[edition]
  const from = decideHostedFrom({
    localPart: 'ernest',
    domain: 'talktosavingkc.com',
    program: copy.program,
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
    edition,
    issue: 1,
    program: copy.program,
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
export function renderNewsletterPreview(edition: NewsletterEditionKey) {
  const issue = renderNewsletterIssue(edition)
  const headerBlock = `<div style="background:#f4f4f5;border:1px solid #d4d4d8;border-radius:6px;padding:8px 12px;font-size:13px;line-height:1.5;color:#3f3f46;margin:0 0 14px"><span style="font-size:11px;color:#71717a">INBOX PREVIEW &middot; </span><b>From:</b> ${escapeHtml(issue.fromName)} &lt;${escapeHtml(issue.fromMailbox)}&gt;<br><b>Subject:</b> ${escapeHtml(issue.subject)}<br><b>Preview:</b> ${escapeHtml(issue.preview)}<br><b>List-Unsubscribe:</b> ${escapeHtml(issue.headers['List-Unsubscribe'])}<br><b>List-Unsubscribe-Post:</b> ${escapeHtml(issue.headers['List-Unsubscribe-Post'])}</div>`
  const html = issue.html.replace(
    '<div style="font-size:15px;line-height:1.5">',
    `${headerBlock}<div style="font-size:15px;line-height:1.5">`,
  )
  return { ...issue, html }
}
