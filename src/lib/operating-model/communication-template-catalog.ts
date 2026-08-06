export type CommunicationTemplateDepartment = 'acquisitions' | 'dispositions' | 'closing_coordination'
export type CommunicationTemplateAudience = 'buyer' | 'seller' | 'title' | 'internal'
export type CommunicationTemplateSource = 'archive' | 'gmail' | 'archive_and_gmail'

export interface CommunicationTemplateDefinition {
  id: string
  slug: string
  title: string
  template_type: 'email'
  audience: CommunicationTemplateAudience
  subject: string
  body: string
  sort_order: number
  department: CommunicationTemplateDepartment
  phase_id: string
  task_type: string
  workflow_id: string
  source: CommunicationTemplateSource
  source_label: string
  catalog: true
}

const emailTemplate = (
  template: Omit<CommunicationTemplateDefinition, 'template_type' | 'catalog'>,
): CommunicationTemplateDefinition => ({ ...template, template_type: 'email', catalog: true })

/**
 * Version-controlled communication standards for the operating system.
 *
 * The archive supplied the original intent. February 2026-forward sent mail
 * supplied the real handoffs, requests, and exception patterns. Deal-specific
 * names, addresses, amounts, links, title contacts, and legal facts are always
 * represented as explicit merge fields so a historic transaction can never be
 * sent to a current contact by accident.
 */
export const COMMUNICATION_TEMPLATE_CATALOG: readonly CommunicationTemplateDefinition[] = [
  emailTemplate({
    id: '793846d5-cdbc-42a0-83e4-6d7512600ab4',
    slug: 'seller-offer-summary',
    title: 'Seller Offer Summary',
    audience: 'seller',
    subject: 'Your Saving KC offer for {{property_address}}',
    body: `Hi {{seller_first_name}},

Thank you for the opportunity to make an offer on {{property_address}}. Here is the proposal we discussed:

- Net purchase price: {{purchase_price}}
- Target closing date: {{closing_date}}
- Earnest money deposit: {{emd_amount}}
- Post-occupancy, if applicable: {{post_occupancy_terms}}
- Seller-paid repairs: $0
- Seller-paid commissions or closing fees: $0
- Moving credit, if applicable: {{moving_credit}}

Documents for review:
{{agreement_links}}

Please review the documents and reply with any questions. We are happy to walk through each term before you sign.

The very best regards,
{{agent_name}}
Saving KC Homebuyers
{{agent_phone}}`,
    sort_order: 10,
    department: 'acquisitions',
    phase_id: 'offer',
    task_type: 'acq.offer.send_summary',
    workflow_id: 'stage-governance',
    source: 'archive_and_gmail',
    source_label: 'Acquisitions archive and sent-mail offer patterns',
  }),
  emailTemplate({
    id: '84faba43-2bc0-48e2-9689-66cf30ad223c',
    slug: 'seller-contract-sent-follow-up',
    title: 'Seller Agreement Follow-up',
    audience: 'seller',
    subject: 'Questions about the agreement for {{property_address}}?',
    body: `Hi {{seller_first_name}},

I wanted to make sure you received the purchase agreement for {{property_address}}.

Is there a term you would like us to explain or adjust before you decide? You can reply here or call/text me at {{agent_phone}}. I am happy to review it with you line by line.

If your plans have changed, please let me know so we can update our records and stop the follow-up.

Best,
{{agent_name}}
Saving KC Homebuyers`,
    sort_order: 20,
    department: 'acquisitions',
    phase_id: 'offer',
    task_type: 'acq.offer.follow_up_contract',
    workflow_id: 'stage-governance',
    source: 'archive_and_gmail',
    source_label: 'Contract-sent sequence, rewritten to match current sent mail',
  }),
  emailTemplate({
    id: '7ff9c2cd-1319-4709-a253-b268b6d02b0b',
    slug: 'seller-welcome-under-contract',
    title: 'Seller Welcome — Under Contract',
    audience: 'seller',
    subject: 'Welcome aboard — what happens next for {{property_address}}',
    body: `Hi {{seller_first_name}},

Welcome aboard. I am {{closing_coordinator_name}}, your Saving KC closing coordinator. My job is to keep the sale organized and make the process easy to follow.

What happens next:

1. I will confirm your contact information, signing preference, and any timing or property-access needs.
2. The title company will open the file, begin the title search, and contact you if it needs additional information.
3. We will coordinate any approved property visit, inspection, photos, or final walkthrough with you in advance.
4. When title and the remaining closing conditions are clear, we will confirm the signing date, location or remote-signing plan, and how you want to receive funds.

Current target closing date: {{closing_date}}
Title company: {{title_company_name}}

Questions are welcome at any time. Reply here or contact me at {{coordinator_phone}}.

Talk soon,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 30,
    department: 'acquisitions',
    phase_id: 'contract_intake',
    task_type: 'ops.contract.explain_closing_process',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive_and_gmail',
    source_label: 'Seller welcome archive plus current handoff practice',
  }),
  emailTemplate({
    id: '6167a50a-de59-4cf1-adfb-05a2f1e46424',
    slug: 'internal-new-contract-handoff',
    title: 'Internal New Contract Handoff',
    audience: 'internal',
    subject: 'New contract handoff: {{property_address}}',
    body: `A new acquisition contract is ready for Dispositions and Closing Coordination.

Property: {{property_address}}
Seller: {{seller_name}}
Acquisition owner: {{agent_name}}
Contract date: {{contract_date}}
Target closing date: {{closing_date}}
Purchase price: {{purchase_price}}
Seller signing preference: {{seller_signing_preference}}
Access or occupancy notes: {{access_notes}}
Title or legal concerns: {{title_notes}}
Approved exit strategy: {{exit_strategy}}

Documents attached or linked:
{{contract_document_links}}

Required first review:
- Confirm the executed contract and economics
- Confirm seller expectations and contact information
- Open the shared property file
- Assign the title-opening and deal-readiness work`,
    sort_order: 40,
    department: 'acquisitions',
    phase_id: 'contract_intake',
    task_type: 'ops.contract.review_acquisition_notes',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'gmail',
    source_label: 'Recurring internal new-contract handoff pattern',
  }),
  emailTemplate({
    id: '99e37502-b5df-4b79-bd10-5150fb9d20d9',
    slug: 'seller-contract-amendment-review',
    title: 'Seller Contract Amendment Review',
    audience: 'seller',
    subject: 'Action requested: updated documents for {{property_address}}',
    body: `Hi {{seller_first_name}},

Please review the updated documents for {{property_address}}:

{{document_summary}}

Review and sign:
{{document_links}}

These documents change only the items summarized above. Please reply with any questions before signing. If timing is important, the requested completion deadline is {{response_deadline}}.

Thank you,
{{agent_name}}
Saving KC Homebuyers`,
    sort_order: 50,
    department: 'acquisitions',
    phase_id: 'contract_intake',
    task_type: 'ops.contract.confirm_terms',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'gmail',
    source_label: 'Sent-mail document-review and amendment pattern',
  }),
  emailTemplate({
    id: 'd8dc0835-581f-4b5d-bd6c-39fd2578a464',
    slug: 'seller-title-progress-update',
    title: 'Seller Title Progress Update',
    audience: 'seller',
    subject: 'Update on the sale of {{property_address}}',
    body: `Hi {{seller_first_name}},

Here is the latest update on {{property_address}}:

- Title file: {{file_number}}
- Current title status: {{title_status}}
- Items still needed: {{open_title_items}}
- Target closing date: {{closing_date}}
- Next update by: {{next_update_date}}

We are actively coordinating the remaining items with {{title_company_name}}. You do not need to do anything unless we contact you with a specific request.

Please reply if your availability, signing preference, occupancy, or access plan has changed.

Best,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 60,
    department: 'closing_coordination',
    phase_id: 'deal_readiness',
    task_type: 'ops.title.confirm_file_number',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive_and_gmail',
    source_label: 'Signed-contract sequence and real title-status follow-up',
  }),
  emailTemplate({
    id: '836b9f91-3a1a-4f52-89b3-46d93e626748',
    slug: 'seller-moving-guide',
    title: 'Seller Moving Guide',
    audience: 'seller',
    subject: 'Moving guide for {{property_address}}',
    body: `Hi {{seller_first_name}},

I am sending our seller moving guide to help you plan the move from {{property_address}}.

Before relying on a date, please confirm the current closing and possession terms with us. Your current plan is:

- Closing date: {{closing_date}}
- Possession or move-out date: {{possession_date}}
- Post-occupancy terms, if any: {{post_occupancy_terms}}

Approved guide or checklist:
{{moving_guide_link}}

Please tell us early if you need help coordinating access, keys, remaining personal property, utilities, or a timing change.

Best,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 70,
    department: 'closing_coordination',
    phase_id: 'deal_readiness',
    task_type: 'ops.contract.confirm_signing_preference',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'gmail',
    source_label: 'Recurring seller moving-guide message',
  }),
  emailTemplate({
    id: '87b794b1-914c-4204-86ea-5f3a2b543b61',
    slug: 'buyer-process-email',
    title: 'Buyer Process & Terms',
    audience: 'buyer',
    subject: 'How to buy a Saving KC property',
    body: `Hi {{buyer_first_name}},

Thank you for your interest in our properties. These are the standard buying expectations unless a property page or written agreement says otherwise:

- Submit your best offer with current proof of funds.
- Complete desired due diligence before the offer deadline, or state what remains.
- Properties are sold as-is, where-is.
- Identify the exact buying entity and authorized signer.
- If selected, sign the assignment agreement and deliver the required EMD by the stated deadline.
- Buyer closing costs, transaction fees, title company, and closing method follow the written deal terms.
- Agent compensation must be requested and approved before offer acceptance.

Property-specific terms always control. Reply with questions before submitting an offer.

The very best regards,
Saving KC Homebuyers
support@savingkc.com
(816) 608-6699`,
    sort_order: 80,
    department: 'dispositions',
    phase_id: 'buyer_marketing',
    task_type: 'ops.marketing.publish_deal',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive_and_gmail',
    source_label: 'Buyer upfront agreement and February sent-mail example',
  }),
  emailTemplate({
    id: 'b157cb3a-6026-4939-acab-5d742ca4c453',
    slug: 'buyer-offer-submission-rules',
    title: 'Buyer Offer Submission Instructions',
    audience: 'buyer',
    subject: 'Offer instructions for {{property_address}}',
    body: `Hello,

Please use the following instructions for {{property_address}}.

Do not contact the homeowner, occupants, neighbors, or service providers. Direct all property questions to Saving KC Homebuyers.

Offer deadline: {{offer_deadline}}
Property information: {{deal_page_url}}

Include:
- Buyer and authorized signer name
- Entity name
- Phone and email
- Offer price
- Funding source
- Current proof of funds
- Additional terms or contingencies
- Whether you want backup-offer consideration

By submitting, you confirm you reviewed the available property information and disclosed any remaining due diligence. If selected, the assignment agreement and EMD are due by the written deadlines.

Send questions to support@savingkc.com or (816) 608-6699.`,
    sort_order: 90,
    department: 'dispositions',
    phase_id: 'buyer_marketing',
    task_type: 'ops.offers.review_spreadsheet',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive',
    source_label: 'Dispositions offer-submission archive',
  }),
  emailTemplate({
    id: '2d5c1fb6-59d2-489d-a565-9a8acda6a99e',
    slug: 'buyer-offer-accepted',
    title: 'Buyer Offer Accepted',
    audience: 'buyer',
    subject: 'Offer accepted — next steps for {{property_address}}',
    body: `Hi {{buyer_first_name}},

Your offer for {{property_address}} has been selected, subject to the written agreement and deadlines below.

Next steps:

1. Review and sign the assignment agreement: {{assignment_link}}
2. Deliver the required EMD of {{emd_amount}} by {{emd_deadline}}: {{emd_link}}
3. Send EMD confirmation to {{emd_confirmation_email}}.
4. Send any missing entity documents or proof of funds.

Title company: {{title_company_name}}
Target closing date: {{closing_date}}

The transaction is not fully committed until the required agreement and EMD are received. Reply immediately if the buying entity, signer, funding source, or timing is incorrect.

Best,
{{disposition_manager_name}}
Saving KC Homebuyers`,
    sort_order: 100,
    department: 'dispositions',
    phase_id: 'assignment',
    task_type: 'ops.assignment.notify_buyer',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive_and_gmail',
    source_label: 'Offer-accepted archive and contract-signing sent mail',
  }),
  emailTemplate({
    id: '0c9553d4-eb65-4cbb-b844-530c4d70fddc',
    slug: 'buyer-assignment-signing-emd',
    title: 'Buyer Assignment & EMD Deadline',
    audience: 'buyer',
    subject: 'Action required: agreement and EMD for {{property_address}}',
    body: `Hi {{buyer_first_name}},

To keep the agreed closing date for {{property_address}}, these items remain:

1. Sign the assignment agreement: {{assignment_link}}
2. Submit the EMD of {{emd_amount}} by {{emd_deadline}}: {{emd_link}}
3. Send the EMD receipt or confirmation to {{emd_confirmation_email}}.

Attached or linked for review:
{{supporting_documents}}

Please reply as soon as both items are complete, or tell us immediately if you cannot meet the deadline.

Thank you,
{{disposition_manager_name}}
Saving KC Homebuyers`,
    sort_order: 110,
    department: 'dispositions',
    phase_id: 'assignment',
    task_type: 'ops.assignment.send_contract',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'gmail',
    source_label: 'Recurring assignment-signing and EMD request pattern',
  }),
  emailTemplate({
    id: '69c272e0-3d04-4257-9940-134c7fb0ce47',
    slug: 'title-executed-assignment',
    title: 'Executed Assignment to Title',
    audience: 'title',
    subject: 'Executed assignment: {{property_address}}',
    body: `Hi {{title_contact_name}},

Please add the executed assignment for {{property_address}} to file {{file_number}}.

Assignor: {{assignor_name}}
Assignee entity: {{assignee_entity}}
Authorized signer: {{assignee_signer}}
Assignment price: {{assignment_contract_price}}
EMD: {{emd_amount}}
Target closing date: {{closing_date}}
Funding type: {{funding_type}}

Attached or linked:
- Executed assignment agreement
- Proof of funds: {{proof_of_funds_link}}
- EMD confirmation: {{emd_receipt_link}}

Please confirm receipt and identify anything still needed from the buyer or Saving KC.

Best regards,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 120,
    department: 'closing_coordination',
    phase_id: 'assignment',
    task_type: 'ops.assignment.send_to_title',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive_and_gmail',
    source_label: 'Executed-assignment archive and current title handoff',
  }),
  emailTemplate({
    id: 'c6a6dd13-49c2-4201-8b2e-ebc79e176895',
    slug: 'buyer-doc-prep',
    title: 'Buyer Document Preparation',
    audience: 'buyer',
    subject: 'Documents needed for {{property_address}}',
    body: `Hi {{buyer_first_name}},

To keep {{property_address}} on schedule, please provide any item below that is not already on file:

- Exact buying entity name
- Authorized signer's full name, email, and phone
- Entity or authority documents requested by title
- Current proof of funds or lender contact
- EMD confirmation
- Agent invoice, if previously approved

All documents and funding should match the buying entity shown in the assignment agreement. Secure wire instructions must come directly from the verified title contact; Saving KC will not replace or alter title's wire instructions by email.

Please send the remaining items by {{document_deadline}}.

Best,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 130,
    department: 'closing_coordination',
    phase_id: 'closing_readiness',
    task_type: 'ops.funding.verify',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive',
    source_label: 'Buyer document-preparation archive',
  }),
  emailTemplate({
    id: 'fe4bed41-a265-4117-9c01-179169f84a14',
    slug: 'buyer-escrow-closer-info',
    title: 'Buyer Title & Closing Contact',
    audience: 'buyer',
    subject: 'Title and closing contact for {{property_address}}',
    body: `Hi {{buyer_first_name}},

Your verified title and closing contact for {{property_address}} is:

{{title_contact_name}}
{{title_contact_role}}
{{title_company_name}}
Email: {{title_contact_email}}
Phone: {{title_contact_phone}}
Office: {{title_company_phone}}

Title will confirm the EMD receipt, closing instructions, and any secure wire instructions. Independently verify wire instructions using the known title-company phone number before sending funds.

Please tell us when the wire or EMD has been submitted so we can confirm the file remains on track.

Best,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 140,
    department: 'closing_coordination',
    phase_id: 'assignment',
    task_type: 'ops.assignment.send_instructions',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive',
    source_label: 'Escrow closer archive, converted to verified merge fields',
  }),
  emailTemplate({
    id: 'c8630a9d-737a-42bf-9034-fb23edfb6d5c',
    slug: 'seller-open-escrow',
    title: 'Open Title / Escrow File',
    audience: 'title',
    subject: 'Open title: {{property_address}}',
    body: `Hi {{title_contact_name}},

Please open a title and escrow file for {{property_address}}.

Seller: {{seller_name}}
Seller phone: {{seller_phone}}
Seller email: {{seller_email}}
Contract date: {{contract_date}}
Purchase price: {{purchase_price}}
Target closing date: {{closing_date}}
Signing preference: {{seller_signing_preference}}
Transaction structure: {{transaction_structure}}

Known title or occupancy notes:
{{title_notes}}

Attached or linked:
{{opening_package_links}}

Please confirm receipt, the assigned closer, and the file number. Send requests for missing information to {{coordinator_email}}.

Best regards,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 150,
    department: 'closing_coordination',
    phase_id: 'deal_readiness',
    task_type: 'ops.title.send_opening_package',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive_and_gmail',
    source_label: 'Open-escrow archive plus actual contract handoff practice',
  }),
  emailTemplate({
    id: '94f3cb2a-1da1-4e8a-a17d-05d2bac44f38',
    slug: 'title-closing-instructions-request',
    title: 'Request Closing Instructions',
    audience: 'title',
    subject: 'Closing instructions requested: {{property_address}}',
    body: `Hi {{title_contact_name}},

Please send the current closing instructions and confirm the remaining conditions for {{property_address}}, file {{file_number}}.

Requested confirmation:
- Scheduled signing date, time, and method for each party
- Final funds required and deadline
- Verified method for delivering wire instructions
- Documents or IDs still needed
- Open title, payoff, lien, probate, occupancy, or funding conditions
- Expected disbursement timing

Current target closing date: {{closing_date}}

Please identify the owner and due date for each remaining condition so the CRM closing plan can be updated accurately.

Thank you,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 160,
    department: 'closing_coordination',
    phase_id: 'closing_readiness',
    task_type: 'ops.docs.request_closing',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive_and_gmail',
    source_label: 'TC closing-instructions SOP and recurring status requests',
  }),
  emailTemplate({
    id: '29f65ad8-0990-4458-bcbe-aff8655e921d',
    slug: 'seller-closing-scheduled',
    title: 'Seller Closing Scheduled',
    audience: 'seller',
    subject: 'Closing plan confirmed for {{property_address}}',
    body: `Hi {{seller_first_name}},

Closing for {{property_address}} is scheduled.

Date and time: {{closing_date_time}}
Signing method or location: {{seller_signing_location}}
Title contact: {{title_contact_name}} at {{title_company_name}}
Items to bring or complete: {{seller_closing_requirements}}
Possession or move-out plan: {{possession_terms}}
Keys and access plan: {{key_handoff_plan}}

Before closing, verify any wire or payment instructions directly with the title company using its known phone number. Please reply to confirm the schedule and tell us immediately if anything has changed.

Best,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 170,
    department: 'closing_coordination',
    phase_id: 'closing_readiness',
    task_type: 'ops.walkthrough.confirm_access',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive_and_gmail',
    source_label: 'Seller instructions SOP and current closing coordination',
  }),
  emailTemplate({
    id: 'f64ecce5-771a-44c9-b149-469c548bff22',
    slug: 'property-overview-request',
    title: 'Property Handoff Information Request',
    audience: 'seller',
    subject: 'Property handoff details for {{property_address}}',
    body: `Hi {{seller_first_name}},

To make the handoff of {{property_address}} easier, please share any information that applies:

- Utility and service providers
- Trash or recycling schedule
- HOA, well, septic, or special service contacts
- Keys, mailbox, garage, lockbox, alarm, or smart-device instructions
- Water shutoff and breaker-panel locations
- Transferable warranties, manuals, or recent service records
- Property quirks the next owner should know

Do not send passwords in ordinary email. We will coordinate a secure handoff for access codes or account credentials.

You can reply with the information or attach a document. If an item is not available, simply mark it unknown.

Thank you,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 180,
    department: 'closing_coordination',
    phase_id: 'closing_day',
    task_type: 'ops.closing.confirm_access',
    workflow_id: 'disposition-operating-lifecycle',
    source: 'archive',
    source_label: 'TC property-overview archive',
  }),
  emailTemplate({
    id: '9b84f1b3-c051-43e4-979a-6d73dbdbabfe',
    slug: 'title-escrow-release-request',
    title: 'Request Escrow / Holdback Release',
    audience: 'title',
    subject: 'Release request for {{property_address}} — file {{file_number}}',
    body: `Hi {{title_contact_name}},

The condition for releasing the remaining escrow or holdback funds on {{property_address}} has been completed.

Release condition: {{release_condition}}
Completion date: {{condition_completed_date}}
Verified by: {{verification_method}}
Supporting evidence: {{evidence_links}}
Amount held, if known: {{escrow_amount}}

Please confirm whether the funds can now be released. If another document, approval, or signature is required, identify the exact item and responsible party.

Thank you,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 190,
    department: 'closing_coordination',
    phase_id: 'post_close',
    task_type: 'ops.aftercare.release_holdback',
    workflow_id: 'disposition-closeout',
    source: 'gmail',
    source_label: 'Observed post-occupancy escrow-release request pattern',
  }),
  emailTemplate({
    id: '0f655b12-e4e4-432d-a162-7387e116151d',
    slug: 'seller-post-close-check-in',
    title: 'Seller Post-close Check-in',
    audience: 'seller',
    subject: 'Checking in after the sale of {{property_address}}',
    body: `Hi {{seller_first_name}},

I wanted to check in now that the sale of {{property_address}} is complete.

Did the signing, move-out or possession handoff, and payment process finish as expected? Is there anything still unresolved that Saving KC or the title company needs to address?

Please reply even if everything is complete. We want the file closed only after your remaining questions are handled.

Thank you again for trusting us with the sale.

Best,
{{closing_coordinator_name}}
Saving KC Homebuyers`,
    sort_order: 200,
    department: 'closing_coordination',
    phase_id: 'post_close',
    task_type: 'ops.aftercare.seller_check_in',
    workflow_id: 'disposition-closeout',
    source: 'archive_and_gmail',
    source_label: 'Post-close checklist and actual aftercare practice',
  }),
  emailTemplate({
    id: '61c69b7d-4ab4-438f-a7e9-3d1bb3bc8316',
    slug: 'seller-testimonial-request',
    title: 'Seller Experience & Review Request',
    audience: 'seller',
    subject: 'How did Saving KC do?',
    body: `Hi {{seller_first_name}},

Now that the sale of {{property_address}} is complete, how was your experience with Saving KC?

Your honest feedback helps us improve the process. If everything went well, would you be willing to leave a review here?

{{review_link}}

If something did not go as expected, please reply directly instead. We want the opportunity to understand and address it before asking for a public review.

Thank you,
{{agent_name}}
Saving KC Homebuyers`,
    sort_order: 210,
    department: 'closing_coordination',
    phase_id: 'post_close',
    task_type: 'ops.testimonial.request',
    workflow_id: 'disposition-closeout',
    source: 'archive_and_gmail',
    source_label: 'Closed-deal sequence rewritten around actual seller experience',
  }),
] as const

const PHASE_LABELS: Record<string, string> = {
  offer: 'Offer & agreement',
  contract_intake: 'Contract intake',
  deal_readiness: 'Due diligence & deal readiness',
  buyer_marketing: 'Buyer marketing & offer selection',
  assignment: 'Assignment & buyer commitment',
  closing_readiness: 'Title, funding & clear to close',
  closing_day: 'Closing day',
  post_close: 'Post-close, debrief & archive',
  custom: 'Custom',
}

export function communicationTemplatePhaseLabel(phaseId: string) {
  return PHASE_LABELS[phaseId] ?? phaseId.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function communicationTemplateDepartmentLabel(department: CommunicationTemplateDepartment) {
  if (department === 'closing_coordination') return 'Closing Coordination'
  return department === 'acquisitions' ? 'Acquisitions' : 'Dispositions'
}

export function communicationTemplateById(id: string) {
  return COMMUNICATION_TEMPLATE_CATALOG.find((template) => template.id === id) ?? null
}

export function communicationTemplateBySlug(slug: string) {
  return COMMUNICATION_TEMPLATE_CATALOG.find((template) => template.slug === slug) ?? null
}

export function unresolvedCommunicationTemplateFields(subject: string | null | undefined, body: string) {
  return Array.from(new Set(`${subject ?? ''}\n${body}`.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? []))
}
