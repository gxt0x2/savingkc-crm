export type LeadActivityCommandKind = 'note' | 'contract_terms' | 'mail_piece'

export interface LeadActivityInsert {
  lead_id: string
  activity_type: 'note' | 'contract_sent' | 'letter_tracking'
  description: string
  agent: string
  metadata: Record<string, unknown>
}

export type LeadActivityCommandResult =
  | { ok: true; insert: LeadActivityInsert }
  | { ok: false; error: string }

const MAIL_PIECES = new Set(['letter', 'postcard', 'thank_you'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

function optionalNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

export function buildLeadActivityInsert(
  leadId: string,
  actorName: string,
  input: unknown,
): LeadActivityCommandResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Activity command required' }
  }

  const body = input as Record<string, unknown>
  const kind = body.kind === undefined ? 'note' : body.kind

  if (kind === 'note') {
    const description = text(body.description, 10_000)
    if (!description) return { ok: false, error: 'lead id and description required' }
    return {
      ok: true,
      insert: {
        lead_id: leadId,
        activity_type: 'note',
        description,
        agent: actorName,
        metadata: { internal: true, source: 'manual_note' },
      },
    }
  }

  if (kind === 'contract_terms') {
    const propertyAddress = text(body.propertyAddress, 500)
    const purchasePrice = optionalNumber(body.purchasePrice, 1, 100_000_000)
    const closingDate = text(body.closingDate, 10)
    if (!propertyAddress || purchasePrice === null || !closingDate || !ISO_DATE.test(closingDate)) {
      return { ok: false, error: 'Property address, purchase price, and closing date are required' }
    }

    const metadata: Record<string, unknown> = {
      buyer: text(body.buyerEntity, 250),
      seller: text(body.sellerName, 250),
      price: purchasePrice,
      earnest: optionalNumber(body.earnestMoney, 0, 10_000_000),
      inspection_days: optionalNumber(body.inspectionDays, 0, 365),
      closing_date: closingDate,
      parcel_id: text(body.parcelId, 250),
      legal_description: text(body.legalDescription, 5_000),
      escrow_company: text(body.escrowCompany, 250),
      source: 'contract_terms_modal',
    }

    return {
      ok: true,
      insert: {
        lead_id: leadId,
        activity_type: 'contract_sent',
        description: `Contract terms recorded for ${propertyAddress}. Purchase price: $${purchasePrice.toLocaleString('en-US')}. Closing date: ${closingDate}`,
        agent: actorName,
        metadata,
      },
    }
  }

  if (kind === 'mail_piece') {
    const pieceType = text(body.pieceType, 20)
    const sentDate = text(body.sentDate, 10)
    if (!pieceType || !MAIL_PIECES.has(pieceType) || !sentDate || !ISO_DATE.test(sentDate)) {
      return { ok: false, error: 'Valid mail piece type and sent date are required' }
    }
    const campaign = text(body.campaign, 250)
    const label = pieceType === 'thank_you'
      ? 'Thank You'
      : `${pieceType.slice(0, 1).toUpperCase()}${pieceType.slice(1)}`

    return {
      ok: true,
      insert: {
        lead_id: leadId,
        activity_type: 'letter_tracking',
        description: campaign ? `${label} sent — ${campaign}` : `${label} sent`,
        agent: actorName,
        metadata: {
          piece_type: pieceType,
          letter_type: pieceType,
          sent_date: sentDate,
          phone_used: text(body.phoneUsed, 100),
          campaign,
          verbiage: text(body.verbiage, 5_000),
          source: 'mail_tracker',
        },
      },
    }
  }

  return { ok: false, error: 'Unsupported activity command' }
}
