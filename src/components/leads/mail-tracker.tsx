// Mail Tracker — log physical mail pieces (letters + postcards + thank you notes)
// sent to a lead. Persists to lead_activities as activity_type='letter_tracking'
// so entries also appear in the main Activity Feed automatically.

'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { CockpitModal } from '@/components/ui/cockpit-modal'
import { useCardCollapse } from '@/hooks/use-card-collapse'

type PieceType = 'letter' | 'postcard' | 'thank_you'

interface MailPiece {
  id: string
  created_at: string
  piece_type: PieceType
  sent_date: string
  phone_used?: string | null
  verbiage?: string | null
  campaign?: string | null
  description: string
}

interface ActivityRow {
  id: string
  activity_type: string
  created_at: string
  description: string | null
  metadata: Record<string, unknown> | null
}

interface MailTrackerProps {
  leadId: string
  leadName?: string | null
  /** Optional callback when a piece is logged or deleted. */
  onLogged?: () => void
}

const PIECE_CONFIG: Record<PieceType, { label: string; icon: string; color: string }> = {
  letter:    { label: 'Letter',    icon: 'mail',         color: 'var(--ck-accent-bright)' },
  postcard:  { label: 'Postcard',  icon: 'filter_none',  color: 'var(--ck-warn)' },
  thank_you: { label: 'Thank You', icon: 'favorite',     color: 'var(--ck-success)' },
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function MailTracker({ leadId, leadName, onLogged }: MailTrackerProps) {
  const [pieces, setPieces] = useState<MailPiece[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [open, toggleOpen] = useCardCollapse('mail-tracker', false)

  async function load() {
    setLoading(true)
    try {
      const response = await fetch(`/api/leads/${leadId}/activities?type=letter_tracking&limit=10`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Mail history unavailable')
      const payload = await response.json().catch(() => ({}))
      const activities = Array.isArray(payload.activities) ? payload.activities as ActivityRow[] : []

      const rows: MailPiece[] = activities
        .filter((row) => row.activity_type === 'letter_tracking')
        .slice(0, 10)
        .map((r) => {
        const md = r.metadata || {}
        return {
          id: r.id,
          created_at: r.created_at,
          piece_type: (typeof md.piece_type === 'string' ? md.piece_type : typeof md.letter_type === 'string' ? md.letter_type : 'letter') as PieceType,
          sent_date: typeof md.sent_date === 'string' ? md.sent_date : r.created_at,
          phone_used: typeof md.phone_used === 'string' ? md.phone_used : null,
          verbiage: typeof md.verbiage === 'string' ? md.verbiage : null,
          campaign: typeof md.campaign === 'string' ? md.campaign : null,
          description: r.description || '',
        }
      })
      setPieces(rows)
    } catch {
      setPieces([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (leadId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId])

  async function handleDelete(id: string) {
    const ok = window.confirm('Delete this mail log entry?')
    if (!ok) return
    const response = await fetch(`/api/leads/activities/${id}`, { method: 'DELETE' })
    if (!response.ok) return
    setPieces((prev) => prev.filter((p) => p.id !== id))
    onLogged?.()
  }

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center justify-between mb-3"
      >
        <div className="flex items-center gap-2">
          <Icon
            name="local_post_office"
            className="!text-base !text-[color:var(--ck-accent)]"
          />
          <h2 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Mail Tracker</h2>
          {pieces.length > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text-muted)' }}
            >
              {pieces.length}
            </span>
          )}
        </div>
        <Icon
          name={open ? 'expand_less' : 'expand_more'}
          className="!text-base !text-[color:var(--ck-text-muted)]"
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="w-full h-10 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 mb-3"
            style={{
              background: 'var(--ck-accent)',
              boxShadow: '0 4px 16px rgba(239,68,68,0.22)',
            }}
          >
            <Icon name="add" className="!text-sm" />
            Log Mail Piece
          </button>

          {loading ? (
            <p className="text-xs py-1" style={{ color: 'var(--ck-text-muted)' }}>
              Loading…
            </p>
          ) : pieces.length === 0 ? (
            <p className="text-xs italic py-1" style={{ color: 'var(--ck-text-muted)' }}>
              No mail sent yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {pieces.map((p) => {
                const cfg = PIECE_CONFIG[p.piece_type] || PIECE_CONFIG.letter
                return (
                  <li
                    key={p.id}
                    className="rounded-lg p-2.5 border group relative"
                    style={{
                      background: 'var(--ck-surface-elev)',
                      borderColor: 'var(--ck-border)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon
                        name={cfg.icon}
                        className={`!text-xs ${
                          p.piece_type === 'letter'
                            ? '!text-[color:var(--ck-accent-bright)]'
                            : p.piece_type === 'postcard'
                              ? '!text-[color:var(--ck-warn)]'
                              : '!text-[color:var(--ck-success)]'
                        }`}
                      />
                      <span
                        className="ck-microlabel !text-[10px]"
                        style={{ color: cfg.color }}
                      >
                        {cfg.label}
                      </span>
                      <span
                        className="text-[10px] ml-auto"
                        style={{ color: 'var(--ck-text-muted)' }}
                      >
                        {formatDate(p.sent_date)}
                      </span>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete"
                        style={{ color: 'var(--ck-text-dim)' }}
                      >
                        <Icon name="close" className="!text-xs" />
                      </button>
                    </div>
                    {p.campaign && (
                      <p
                        className="text-[11px] font-semibold"
                        style={{ color: 'var(--ck-text)' }}
                      >
                        {p.campaign}
                      </p>
                    )}
                    {p.verbiage && (
                      <p
                        className="text-[11px] italic mt-0.5 leading-snug line-clamp-2"
                        style={{ color: 'var(--ck-text-muted)' }}
                      >
                        &ldquo;{p.verbiage}&rdquo;
                      </p>
                    )}
                    {p.phone_used && (
                      <p
                        className="text-[10px] mt-0.5 flex items-center gap-1"
                        style={{ color: 'var(--ck-text-dim)' }}
                      >
                        <Icon name="phone" className="!text-[10px]" />
                        {p.phone_used}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <LogMailModal
        open={showModal}
        onClose={() => setShowModal(false)}
        leadId={leadId}
        leadName={leadName}
        onLogged={() => {
          setShowModal(false)
          load()
          onLogged?.()
        }}
      />
    </section>
  )
}

// ── Log Mail Modal ────────────────────────────────────────────────────────────
interface LogMailModalProps {
  open: boolean
  onClose: () => void
  leadId: string
  leadName?: string | null
  onLogged: () => void
}

function LogMailModal({ open, onClose, leadId, leadName, onLogged }: LogMailModalProps) {
  const [pieceType, setPieceType] = useState<PieceType>('letter')
  const [sentDate, setSentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [phoneUsed, setPhoneUsed] = useState('')
  const [campaign, setCampaign] = useState('')
  const [verbiage, setVerbiage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPieceType('letter')
      setSentDate(new Date().toISOString().slice(0, 10))
      setPhoneUsed('')
      setCampaign('')
      setVerbiage('')
      setError(null)
    }
  }, [open])

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/leads/${leadId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'mail_piece',
          pieceType,
          sentDate,
          phoneUsed,
          campaign,
          verbiage,
          leadName,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to log mail piece')
      }
      onLogged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log mail piece')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--ck-surface-elev)',
    border: '1px solid var(--ck-border)',
    color: 'var(--ck-text)',
  }

  return (
    <CockpitModal
      open={open}
      onClose={onClose}
      title="Log Mail Piece"
      icon="local_post_office"
      size="md"
    >
      <div className="space-y-4">
        {/* Piece type */}
        <div>
          <label className="ck-microlabel block mb-2">Piece Type</label>
          <div className="grid grid-cols-3 gap-2">
            {(['letter', 'postcard', 'thank_you'] as PieceType[]).map((t) => {
              const cfg = PIECE_CONFIG[t]
              const active = pieceType === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPieceType(t)}
                  className="h-14 rounded-lg border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-colors"
                  style={{
                    background: active ? 'rgba(239,68,68,0.08)' : 'var(--ck-surface-elev)',
                    borderColor: active ? 'var(--ck-accent)' : 'var(--ck-border)',
                    color: active ? 'var(--ck-text)' : 'var(--ck-text-muted)',
                  }}
                >
                  <Icon name={cfg.icon} className="!text-sm" />
                  {cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Date + Campaign */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ck-microlabel block mb-2">Date Sent</label>
            <input
              type="date"
              value={sentDate}
              onChange={(e) => setSentDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ ...inputStyle, colorScheme: 'dark' }}
            />
          </div>
          <div>
            <label className="ck-microlabel block mb-2">Campaign</label>
            <input
              type="text"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="e.g., Q2 tax delinquent"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Phone used */}
        <div>
          <label className="ck-microlabel block mb-2">Phone Number on Mailer</label>
          <input
            type="tel"
            value={phoneUsed}
            onChange={(e) => setPhoneUsed(e.target.value)}
            placeholder="+1 (816) 307-7835"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
        </div>

        {/* Verbiage */}
        <div>
          <label className="ck-microlabel block mb-2">Verbiage</label>
          <textarea
            value={verbiage}
            onChange={(e) => setVerbiage(e.target.value)}
            placeholder="The exact copy that went out on the mailer…"
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-sm resize-none outline-none"
            style={inputStyle}
          />
        </div>

        {error && (
          <p className="text-xs" style={{ color: 'var(--ck-accent-bright)' }}>
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ color: 'var(--ck-text-muted)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50 transition-opacity"
            style={{
              background: 'var(--ck-accent)',
              boxShadow: '0 4px 16px rgba(239,68,68,0.22)',
            }}
          >
            {saving ? 'Saving…' : 'Log Mail Piece'}
          </button>
        </div>
      </div>
    </CockpitModal>
  )
}
