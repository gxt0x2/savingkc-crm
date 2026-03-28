// MNT-01: Mail Tracking Model + Visual Pipeline
// MNT-02: Auto Follow-Up Task
// MNT-03: Mail History + Batch View
// Night 4 Phase 2: Handwritten Note Tracker

'use client'

import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'

type MailType = 'handwritten_note' | 'postcard' | 'letter' | 'package'
type MailStatus = 'queued' | 'written' | 'mailed' | 'in_transit' | 'delivered' | 'follow_up_scheduled' | 'follow_up_completed' | 'returned'

interface MailPiece {
  id: string
  lead_id: string
  type: MailType
  status: MailStatus
  created_at: string
  written_date: string | null
  mailed_date: string | null
  estimated_delivery_date: string | null
  actual_delivery_date: string | null
  follow_up_date: string | null
  follow_up_completed_date: string | null
  follow_up_task_id: string | null
  notes: string | null
  tracking_number: string | null
  created_by: string | null
}

interface MailTrackerProps {
  leadId: string
  leadName?: string
  onAddMail?: () => void
}

const MAIL_TIMELINE_STEPS = [
  { key: 'queued', label: 'Queued', icon: 'inbox' },
  { key: 'written', label: 'Written/Printed', icon: 'edit' },
  { key: 'mailed', label: 'Mailed', icon: 'send', showDate: 'mailed_date' },
  { key: 'in_transit', label: 'In Transit', icon: 'local_shipping' },
  { key: 'delivered', label: 'Est. Delivered', icon: 'check_circle', showDate: 'estimated_delivery_date' },
  { key: 'follow_up_scheduled', label: 'Follow-up', icon: 'phone', showDate: 'follow_up_date' },
] as const

const STATUS_ORDER: MailStatus[] = ['queued', 'written', 'mailed', 'in_transit', 'delivered', 'follow_up_scheduled', 'follow_up_completed', 'returned']

function getStepStatus(currentStatus: MailStatus, stepKey: string): 'completed' | 'current' | 'pending' {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus)
  const stepIndex = STATUS_ORDER.indexOf(stepKey as MailStatus)

  if (currentStatus === 'follow_up_completed' && stepKey === 'follow_up_scheduled') {
    return 'completed'
  }

  if (currentIndex > stepIndex) return 'completed'
  if (currentIndex === stepIndex) return 'current'
  return 'pending'
}

function formatDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getMailTypeLabel(type: MailType): string {
  const labels: Record<MailType, string> = {
    handwritten_note: '✍️ Handwritten Note',
    postcard: '🏞 Postcard',
    letter: 'Letter',
    package: '📦 Package',
  }
  return labels[type]
}

export function MailTracker({ leadId, leadName, onAddMail }: MailTrackerProps) {
  const [mailPieces, setMailPieces] = useState<MailPiece[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPiece, setSelectedPiece] = useState<MailPiece | null>(null)

  useEffect(() => {
    fetchMailPieces()
  }, [leadId])

  async function fetchMailPieces() {
    const supabase = createClient()
    const { data } = await supabase
      .from('mail_pieces')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })

    setMailPieces((data as MailPiece[]) || [])
    setLoading(false)
  }

  async function updateMailStatus(pieceId: string, newStatus: MailStatus, dateField?: string) {
    const supabase = createClient()

    const updateData: any = { status: newStatus }

    // If transitioning to 'mailed', set mailed_date to today
    if (newStatus === 'mailed' && dateField === 'mailed_date') {
      updateData.mailed_date = new Date().toISOString().split('T')[0]
      // Trigger will auto-calculate estimated_delivery_date and follow_up_date
    }

    // If transitioning to 'written', set written_date
    if (newStatus === 'written') {
      updateData.written_date = new Date().toISOString().split('T')[0]
    }

    // If transitioning to 'delivered', set actual_delivery_date
    if (newStatus === 'delivered') {
      updateData.actual_delivery_date = new Date().toISOString().split('T')[0]
    }

    // If completing follow-up, set follow_up_completed_date
    if (newStatus === 'follow_up_completed') {
      updateData.follow_up_completed_date = new Date().toISOString().split('T')[0]
    }

    const { error } = await supabase
      .from('mail_pieces')
      .update(updateData)
      .eq('id', pieceId)

    if (!error) {
      await fetchMailPieces()

      // If we just marked as mailed, create follow-up task (MNT-02)
      if (newStatus === 'mailed') {
        await createFollowUpTask(pieceId)
      }
    }
  }

  async function createFollowUpTask(mailPieceId: string) {
    const piece = mailPieces.find(p => p.id === mailPieceId)
    if (!piece) return

    const supabase = createClient()

    // Calculate follow-up date (estimated_delivery + 2 business days)
    // This will be auto-calculated by the DB trigger, so we fetch it
    const { data: updatedPiece } = await supabase
      .from('mail_pieces')
      .select('follow_up_date, estimated_delivery_date')
      .eq('id', mailPieceId)
      .single()

    if (!updatedPiece?.follow_up_date) return

    // Create follow-up task in lead_activities
    const { data: task, error } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        type: 'task',
        description: `Follow up on ${getMailTypeLabel(piece.type).split(' ')[1]} sent — estimated delivered ${formatDate(updatedPiece.estimated_delivery_date)}`,
        agent: 'System',
        metadata: {
          task_type: 'follow_up_mail',
          mail_piece_id: mailPieceId,
          due_date: updatedPiece.follow_up_date,
          channel: 'call',
          priority: 'high',
        },
      })
      .select()
      .single()

    if (!error && task) {
      // Link task back to mail piece
      await supabase
        .from('mail_pieces')
        .update({ follow_up_task_id: task.id, status: 'follow_up_scheduled' })
        .eq('id', mailPieceId)

      await fetchMailPieces()
    }
  }

  const needsFollowUp = mailPieces.filter(p =>
    p.status === 'follow_up_scheduled' && !p.follow_up_completed_date
  ).length

  if (loading) {
    return (
      <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <div className="text-center py-8 text-on-surface-variant/60">Loading...</div>
      </section>
    )
  }

  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary">
            Mail Tracking
          </h2>
          {needsFollowUp > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
              {needsFollowUp} Need Follow-Up
            </span>
          )}
        </div>
        {onAddMail && (
          <button
            onClick={onAddMail}
            className="text-primary hover:text-secondary transition-colors"
            title="Add mail piece"
          >
            <Icon name="add_circle" size="text-lg" />
          </button>
        )}
      </div>

      {/* Mail Pieces List */}
      {mailPieces.length === 0 ? (
        <div className="text-center py-8">
          <Icon name="mail" className="!text-4xl text-on-surface-variant/30 mb-3" />
          <p className="text-sm font-bold text-on-surface-variant/60 mb-1">No Mail Sent Yet</p>
          <p className="text-xs text-on-surface-variant/40 mb-4">
            Track handwritten notes, postcards, and direct mail here.
          </p>
          {onAddMail && (
            <button
              onClick={onAddMail}
              className="px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold hover:opacity-90 transition-all"
            >
              Add Mail Piece
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {mailPieces.map((piece) => (
            <div key={piece.id} className="border border-outline-variant/20 rounded-xl p-4 bg-surface-container-low">
              {/* Mail Type Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-primary">
                    {getMailTypeLabel(piece.type)}
                  </span>
                  <span className="text-[10px] text-on-surface-variant">
                    {formatDate(piece.created_at)}
                  </span>
                </div>
                {piece.tracking_number && (
                  <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-1 rounded">
                    {piece.tracking_number}
                  </span>
                )}
              </div>

              {/* Visual Timeline */}
              <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-3">
                {MAIL_TIMELINE_STEPS.map((step, idx) => {
                  const status = getStepStatus(piece.status, step.key)
                  const dateField = ('showDate' in step ? step.showDate : undefined) as keyof MailPiece | undefined
                  const dateValue = dateField ? piece[dateField] : null

                  return (
                    <div key={step.key} className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => updateMailStatus(piece.id, step.key as MailStatus, ('showDate' in step ? step.showDate : undefined))}
                        disabled={status === 'completed' && piece.status !== 'follow_up_scheduled'}
                        className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          status === 'current'
                            ? 'bg-primary text-white shadow-sm'
                            : status === 'completed'
                            ? 'bg-green-100 text-green-700 cursor-default'
                            : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                        }`}
                      >
                        <Icon name={status === 'completed' ? 'check_circle' : step.icon} size="text-sm" />
                        <span className="text-center leading-tight">{step.label}</span>
                        {dateValue && typeof dateValue === 'string' && (
                          <span className="text-[9px] opacity-80">{formatDate(dateValue)}</span>
                        )}
                      </button>
                      {idx < MAIL_TIMELINE_STEPS.length - 1 && (
                        <div className={`h-0.5 w-3 rounded-full ${
                          status === 'completed' ? 'bg-green-500' : 'bg-outline-variant/30'
                        }`} />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Notes */}
              {piece.notes && (
                <p className="text-xs text-on-surface-variant bg-surface-container px-3 py-2 rounded-lg">
                  {piece.notes}
                </p>
              )}

              {/* Follow-Up Alert */}
              {piece.status === 'follow_up_scheduled' && piece.follow_up_date && (
                <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
                  <Icon name="phone" className="!text-sm text-amber-600" />
                  <span className="text-xs text-amber-800">
                    Follow-up call scheduled: {formatDate(piece.follow_up_date)}
                  </span>
                  <button
                    onClick={() => updateMailStatus(piece.id, 'follow_up_completed')}
                    className="ml-auto px-3 py-1 bg-amber-600 text-white rounded text-[10px] font-bold hover:bg-amber-700"
                  >
                    Mark Complete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* View All Link */}
      {mailPieces.length > 3 && (
        <button className="w-full mt-4 py-2 border border-outline-variant/30 rounded-lg text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-all">
          View Full Mail History ({mailPieces.length} pieces)
        </button>
      )}
    </section>
  )
}
