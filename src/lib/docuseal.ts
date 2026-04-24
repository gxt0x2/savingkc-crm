// DocuSeal API client.
// Base URL + token live in env. sign.savingkc.com is the self-hosted instance;
// token comes from Settings → API in the DocuSeal UI.
//
// API reference: https://www.docuseal.com/docs/api

const BASE_URL = process.env.DOCUSEAL_URL || 'https://sign.savingkc.com'
const TOKEN = process.env.DOCUSEAL_TOKEN

function authHeaders() {
  if (!TOKEN) throw new Error('DOCUSEAL_TOKEN is not set')
  return { 'X-Auth-Token': TOKEN, 'Content-Type': 'application/json' }
}

export interface DocusealSubmitter {
  id: number
  uuid: string
  submission_id: number
  email: string
  slug: string
  embed_src?: string
  sent_at: string | null
  opened_at: string | null
  completed_at: string | null
  role: string
  name: string | null
  phone: string | null
  external_id: string | null
  values: Record<string, unknown>
}

export interface DocusealSubmission {
  id: number
  uuid: string
  status: string
  audit_log_url: string | null
  submitters: DocusealSubmitter[]
  documents?: { name: string; url: string }[]
  completed_at: string | null
  created_at: string
  updated_at: string
}

// Create a submission. If `sendEmail` is false, DocuSeal stores the
// submission + prefilled values but doesn't email the signers — useful for
// showing a preview before committing.
export async function createSubmission(opts: {
  templateId: number
  sendEmail: boolean
  submitters: Array<{
    role: string
    email: string
    name?: string | null
    phone?: string | null
    external_id?: string | null
    values?: Record<string, string | number | null | undefined>
  }>
}): Promise<DocusealSubmission> {
  const res = await fetch(`${BASE_URL}/api/submissions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      template_id: opts.templateId,
      send_email: opts.sendEmail,
      submitters: opts.submitters.map(s => ({
        role: s.role,
        email: s.email,
        name: s.name ?? undefined,
        phone: s.phone ?? undefined,
        external_id: s.external_id ?? undefined,
        values: s.values ?? {},
      })),
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`DocuSeal createSubmission ${res.status}: ${body}`)
  }
  const data = await res.json()
  // /api/submissions returns an array of submitters directly in some versions;
  // normalize to the submission shape our callers expect.
  if (Array.isArray(data)) {
    return {
      id: data[0]?.submission_id,
      uuid: '',
      status: 'pending',
      audit_log_url: null,
      submitters: data as DocusealSubmitter[],
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }
  return data as DocusealSubmission
}

export async function getSubmission(id: number | string): Promise<DocusealSubmission> {
  const res = await fetch(`${BASE_URL}/api/submissions/${id}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`DocuSeal getSubmission ${res.status}: ${await res.text()}`)
  return res.json()
}

// Archive cancels the submission. Use this if the user clicks Cancel on the
// preview — keeps DocuSeal tidy so we don't leak ghost submissions.
export async function archiveSubmission(id: number | string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/submissions/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`DocuSeal archiveSubmission ${res.status}: ${await res.text()}`)
}

// Trigger the invitation email for an existing submitter. Used when the user
// approves the preview and clicks "Send to Buyer".
export async function sendSubmitterInvite(submitterId: number | string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/submitters/${submitterId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ send_email: true }),
  })
  if (!res.ok) throw new Error(`DocuSeal sendSubmitterInvite ${res.status}: ${await res.text()}`)
}

export const ASSIGNMENT_TEMPLATE_ID = Number(process.env.DOCUSEAL_ASSIGNMENT_TEMPLATE_ID || 19)
export const DOCUSEAL_PUBLIC_URL = BASE_URL
