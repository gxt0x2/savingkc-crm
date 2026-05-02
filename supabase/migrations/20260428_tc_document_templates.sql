-- Reusable Saving KC TC document/email templates cleaned from legacy DOCX files.

CREATE TABLE IF NOT EXISTS tc_document_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('email','document','checklist')),
  audience TEXT NOT NULL CHECK (audience IN ('buyer','seller','title','internal')),
  subject TEXT,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_document_templates_active
  ON tc_document_templates(is_active, sort_order)
  WHERE is_active = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tc_document_templates_updated_at') THEN
    CREATE TRIGGER tc_document_templates_updated_at BEFORE UPDATE ON tc_document_templates
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

INSERT INTO tc_document_templates (slug, title, template_type, audience, subject, body, sort_order)
VALUES
(
  'buyer-upfront-agreement',
  'Buyer Upfront Agreement',
  'document',
  'buyer',
  NULL,
  $template$Saving KC Homebuyers Buyer Upfront Agreement

1. Transactions are cash or cash-equivalent unless Saving KC Homebuyers approves otherwise in writing.
2. Buyers should complete all desired inspections before submitting an offer. A buyer may waive inspection.
3. Realtors and their buyers are welcome. Agent compensation must be discussed and approved before offer acceptance.
4. Buyer acknowledges that one or more Saving KC principals may hold active real estate licenses in Missouri and/or Kansas. Unless separately agreed in writing, they are not acting as the buyer's or seller's representative.
5. Buyer agrees to purchase the property in as-is, where-is condition.
6. Buyer pays all closing costs unless the written agreement says otherwise.
7. Buyer agrees to pay the transaction coordination fee stated in the deal terms, when applicable.
8. Closing occurs at the title company selected by Saving KC Homebuyers or the seller/assignor.
9. Buyer must submit proof of funds or a recent bank statement with the offer.
10. Once an offer is accepted, buyer must submit the required non-refundable earnest money deposit by the stated deadline. If clear, marketable, transferable title cannot be delivered, the EMD is refundable under the contract terms.$template$,
  10
),
(
  'buyer-process-email',
  'Buyer Process Email',
  'email',
  'buyer',
  'Info: Our Buying Process',
  $template$Hi {{buyer_first_name}},

Thanks for your interest in our properties. To keep the process clear for everyone, here are the core terms:

- Cash or equivalent offers only. Include proof of funds or a recent bank statement with your offer.
- Complete inspections before submitting your offer, or confirm that you waive inspection.
- Properties are sold as-is, where-is.
- Once your offer is accepted, the required non-refundable earnest money deposit is due to title by the stated deadline.
- Buyer covers closing costs unless otherwise stated in writing.
- We close through the title company selected by Saving KC Homebuyers or the seller/assignor.
- Realtors are welcome. Agent compensation must be discussed and approved before acceptance.
- One or more Saving KC principals may hold active real estate licenses in Missouri and/or Kansas. Unless separately agreed in writing, they are not representing the buyer or seller.

Submitting an offer means you agree to these terms.

The very best regards,
Saving KC Homebuyers
support@savingkc.com
(816) 608-6699$template$,
  20
),
(
  'buyer-offer-submission-rules',
  'Offer Submission Rules',
  'email',
  'buyer',
  'Offer Submission Instructions for {{property_address}}',
  $template$Hello,

Please follow these instructions carefully when submitting an offer for {{property_address}}.

Critical rule: do not contact the homeowner for any reason. Any attempt to contact the seller directly may result in removal from our buyer list.

Send all property questions to Saving KC Homebuyers at support@savingkc.com or (816) 608-6699.

Before submitting:
- Review all photos, notes, inspection reports, and disclosures provided.
- Complete any desired inspection or confirm you are waiving inspection.
- Submit your best and final offer by the deadline. Late offers may not be accepted.

Include:
- Full name
- Phone number
- Email address
- LLC/entity name and authorized signer, if applicable
- Offer price
- Funding source
- Additional terms
- Proof of funds
- Whether you want to be considered as a backup offer

If accepted:
- You will receive the assignment agreement and next steps.
- EMD is due by the stated deadline.
- Send a screenshot or copy of your EMD confirmation to deals@savingkc.com.
- The agreement is not enforceable until the EMD is received as required.

Agent compensation, if applicable, must be requested and approved before offer acceptance. Invoices should be submitted directly to title for payment at closing.

The EMD is refundable only if Saving KC Homebuyers cannot deliver clear, marketable, transferable title under the contract terms.$template$,
  30
),
(
  'buyer-offer-accepted',
  'Offer Accepted Email',
  'email',
  'buyer',
  'Your Offer Was Accepted - Next Steps',
  $template$Hi {{buyer_first_name}},

Great news. Your offer for {{property_address}} has been accepted.

Next steps:

1. Assignment agreement
You should receive the assignment agreement shortly. If you do not see it, contact us right away.

2. Earnest money deposit
Your EMD is due by {{emd_deadline}}. Send a screenshot or copy of your EMD confirmation to deals@savingkc.com.

3. Title and closing coordination
The title company will contact you with closing instructions, secure wire instructions if needed, and scheduling details.

4. Final documents
Once funds are received and closing is complete, final closing documents will be distributed through title.

The very best regards,
Saving KC Homebuyers
deals@savingkc.com
(816) 608-6699$template$,
  40
),
(
  'seller-open-escrow',
  'Open Escrow Email',
  'email',
  'title',
  'Open Escrow: {{property_address}}',
  $template$Hi {{title_contact_name}},

Please open escrow for {{property_address}}. The purchase contract has been executed, and the earnest money terms are included in the attached agreement.

Contract details:
- Property address: {{property_address}}
- Buyer/assignor: Saving KC Homebuyers
- Seller: {{seller_name}}
- Seller signing preference: {{seller_signing_preference}}
- Contract date: {{contract_date}}
- Purchase price: {{purchase_price}}
- Contract expiration: {{contract_expiration}}
- Transaction type: Assignment

Seller contact:
- Name: {{seller_name}}
- Phone: {{seller_phone}}
- Email: {{seller_email}}
- Future mailing address: {{seller_mailing_address}}

File notes:
- Marital status: {{marital_status}}
- Pre-foreclosure: {{pre_foreclosure}}
- Tax delinquent: {{tax_delinquent}}
- Probate/heirs: {{probate_notes}}
- Other title notes: {{title_notes}}

Attached:
- Fully executed purchase agreement
- Addenda or post-occupancy agreement, if applicable
- Any seller disclosures or title-supporting documents currently available

Please confirm receipt and send the title file number when available.

The very best regards,
Saving KC Homebuyers
support@savingkc.com
(816) 608-6699$template$,
  50
),
(
  'title-executed-assignment',
  'Executed Assignment to Title',
  'email',
  'title',
  'Fully Executed Assignment: {{property_address}}',
  $template$Hi {{title_contact_name}},

Please add the fully executed assignment for {{property_address}} to the title file.

Transaction details:
- Property address: {{property_address}}
- Assignor: Saving KC Homebuyers
- Original contract date: {{contract_date}}
- Assignment executed: {{assignment_executed_date}}
- Assignment expiration: {{assignment_expiration_date}}
- Assignment contract price: {{assignment_contract_price}}
- Non-refundable EMD: {{emd_amount}}

Assignee information:
- Entity name: {{assignee_entity}}
- Authorized signer: {{assignee_signer}}
- Phone: {{assignee_phone}}
- Email: {{assignee_email}}
- Funding type: {{funding_type}}
- Signing preference: {{signing_preference}}

Attached:
- Fully executed assignment agreement
- Buyer proof of funds, if available
- EMD confirmation, if available

Please confirm receipt and let us know if anything else is needed to keep closing on track.

Best regards,
Saving KC Homebuyers
deals@savingkc.com
(816) 608-6699$template$,
  60
),
(
  'buyer-doc-prep',
  'Buyer Document Prep Email',
  'email',
  'buyer',
  'Documents Needed to Keep {{property_address}} Closing on Track',
  $template$Hi {{buyer_first_name}},

To keep closing for {{property_address}} on schedule, please send the following as soon as possible if not already on file:

- Signed articles of organization or entity documents
- Authorized signer's full name, email, and phone
- Proof of funds
- EMD confirmation
- Commission invoice, if applicable

All documents must match the buying entity name exactly. The title company will provide wire instructions securely once verified.

The very best regards,
Saving KC Homebuyers
deals@savingkc.com
(816) 608-6699$template$,
  70
),
(
  'buyer-escrow-closer-info',
  'Escrow Closer Info Email',
  'email',
  'buyer',
  'Escrow and Closing Contact for {{property_address}}',
  $template$Hi {{buyer_first_name}},

Thank you again for your prompt action on {{property_address}}.

Your escrow/closing contact is:

{{title_contact_name}}
{{title_contact_role}}
{{title_company_name}}
Email: {{title_contact_email}}
Phone: {{title_contact_phone}}
Office: {{title_company_phone}}
Address: {{title_company_address}}

You can expect official EMD receipt and closing instructions directly from title. Please let us know once your wire has been sent so we can verify everything is on track.

Best regards,
Saving KC Homebuyers
deals@savingkc.com
(816) 608-6699$template$,
  80
),
(
  'title-escrow-vetting',
  'Title / Escrow Vetting Checklist',
  'checklist',
  'internal',
  NULL,
  $template$Core fit:
- What transaction types do you avoid or prefer not to handle?
- Are you comfortable with assignments, double closes, seller finance, and investor transactions?
- How do you handle probate, multiple heirs, quiet title, redemptions, tax liens, or foreclosure-related issues?
- Do you have in-house attorneys or a legal review process for non-standard documents?

Speed and communication:
- Do you offer expedited processing for time-sensitive cash closings?
- What is your typical open-to-close timeline for an all-cash assignment?
- What is your expected response time for questions or document requests?
- Do investor clients get a dedicated point of contact?
- What is your process and standard timeline for title commitments and payoff requests?

Process:
- What exactly do you need from us to open a file immediately?
- Do you support mobile notary or remote online notarization?
- When is a wet signature required?
- How do you prefer contracts, IDs, death certificates, affidavits, and related documents?
- How do you handle EMD: ACH, wire, portal, or physical drop-off?
- Is the EMD receipt automatic or manual, and how long does it take?
- When and how are secure wire instructions delivered?

Partnership:
- How can Saving KC help you process files faster and more accurately?
- What phone/email communication preferences should our TC team use?$template$,
  90
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  template_type = EXCLUDED.template_type,
  audience = EXCLUDED.audience,
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = NOW();
