'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'

export type DispositionType =
  | 'answered'
  | 'no_answer'
  | 'left_vm'
  | 'bad_number'
  | 'busy'
  | 'dnc'
  | 'spoke_with_owner'
  | 'callback_requested'
  | 'not_interested'
  | 'wrong_number'
  | 'disconnected'
  | 'deal_potential'
  | 'appointment_set'
  | 'offer_made'
  | 'dead'

type DispositionTone = 'success' | 'warning' | 'info' | 'neutral' | 'danger' | 'critical'

interface DispositionOption {
  id: DispositionType
  label: string
  tone: DispositionTone
  icon: string
  hasSubreason?: boolean
}

interface NextActionOption {
  id: string
  label: string
  icon: string
  currentValueLabel?: string
}

interface ContactSummary {
  name?: string | null
  phone?: string | null
  leadId?: string | number | null
  initials?: string | null
  avatarUrl?: string | null
}

interface DispositionModalProps {
  open: boolean
  onClose: () => void
  onDisposition: (
    disposition: DispositionType,
    notes?: string,
    options?: { markAsLead?: boolean; autoDialNext?: boolean },
  ) => void | boolean | Promise<void | boolean>
  phoneNumber?: string
  leadName?: string
  markAsLeadAvailable?: boolean
  markAsLeadLabel?: string

  onSkip?: () => void
  callDuration?: string
  callEndedAtLabel?: string
  connectionStatus?: 'connected' | 'voicemail' | 'no_answer' | string
  connectionTimeLabel?: string

  dispositions?: DispositionOption[]
  selectedDisposition?: DispositionType | null
  onDispositionChange?: (disposition: DispositionType) => void

  nextActions?: NextActionOption[]
  onNextActionPick?: (actionId: string) => void

  notes?: string
  onNotesChange?: (notes: string) => void
  aiSummary?: string | null
  onUseAiSummary?: (summary: string) => void

  onSave?: () => void
  onSaveAndNext?: () => void
  isSaving?: boolean
  contact?: ContactSummary
  variant?: 'compact' | 'heirQueue'
  primaryActionLabel?: string
  secondaryActionLabel?: string
}

const DEFAULT_DISPOSITIONS: DispositionOption[] = [
  { id: 'answered', label: 'Answered', tone: 'success', icon: 'check_circle' },
  { id: 'spoke_with_owner', label: 'Spoke With Seller', tone: 'success', icon: 'record_voice_over' },
  { id: 'callback_requested', label: 'Callback Requested', tone: 'success', icon: 'event_available' },
  { id: 'deal_potential', label: 'Deal Potential', tone: 'warning', icon: 'local_fire_department' },
  { id: 'appointment_set', label: 'Appointment Set', tone: 'success', icon: 'event' },
  { id: 'not_interested', label: 'Not Interested', tone: 'neutral', icon: 'thumb_down' },
  { id: 'no_answer', label: 'No Answer', tone: 'neutral', icon: 'no_answer_badge' },
  { id: 'left_vm', label: 'Left Voicemail', tone: 'info', icon: 'voicemail', hasSubreason: true },
  { id: 'bad_number', label: 'Bad Number', tone: 'danger', icon: 'error' },
  { id: 'wrong_number', label: 'Wrong Number', tone: 'danger', icon: 'phone_disabled' },
  { id: 'disconnected', label: 'Disconnected', tone: 'danger', icon: 'signal_cellular_connected_no_internet_4_bar' },
  { id: 'busy', label: 'Busy', tone: 'warning', icon: 'phone_paused' },
  { id: 'dnc', label: 'Do Not Call', tone: 'critical', icon: 'block' },
  { id: 'dead', label: 'Dead Lead', tone: 'critical', icon: 'delete' },
]

const TONE_TILE_CLASS: Record<DispositionTone, string> = {
  success: 'bg-[#30D1582E] text-[#30D158]',
  warning: 'bg-[#FF9F0A2E] text-[#FF9F0A]',
  info: 'bg-[#64D2FF2E] text-[#64D2FF]',
  neutral: 'bg-[#98989E38] text-[var(--skc-text-secondary)]',
  danger: 'bg-[#FF453A2E] text-[#FF453A]',
  critical: 'bg-[#FF453A47] text-[#FF453A]',
}

function initialsFromName(name?: string | null): string {
  if (!name) return '—'
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function ConnectionPill({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#30D1582E] text-[#30D158] text-[11px] font-medium">
        <Icon name="call" size="text-[11px]" filled />
        Connected
      </span>
    )
  }
  if (status === 'voicemail') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#64D2FF2E] text-[#64D2FF] text-[11px] font-medium">
        <Icon name="voicemail" size="text-[11px]" />
        Voicemail
      </span>
    )
  }
  if (status === 'no_answer') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#98989E38] text-[var(--skc-text-secondary)] text-[11px] font-medium">
        <Icon name="phone_missed" size="text-[11px]" />
        No Answer
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#98989E38] text-[var(--skc-text-secondary)] text-[11px] font-medium capitalize">
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function Chevron() {
  return <Icon name="chevron_right" size="text-[14px]" className="text-[var(--skc-text-quaternary)]" />
}

function CheckActive() {
  return (
    <span className="w-[22px] h-[22px] rounded-full bg-[var(--skc-brand)] inline-flex items-center justify-center">
      <Icon name="check" size="text-[13px]" className="text-white" />
    </span>
  )
}

export function DispositionModal({
  open,
  onClose,
  onDisposition,
  phoneNumber,
  leadName,
  markAsLeadAvailable = false,
  markAsLeadLabel,
  onSkip,
  callDuration,
  callEndedAtLabel = 'Just ended',
  connectionStatus = 'connected',
  connectionTimeLabel,
  dispositions = DEFAULT_DISPOSITIONS,
  selectedDisposition,
  onDispositionChange,
  nextActions = [],
  onNextActionPick,
  notes,
  onNotesChange,
  aiSummary = null,
  onUseAiSummary,
  onSave,
  onSaveAndNext,
  isSaving = false,
  contact,
  variant = 'compact',
  primaryActionLabel = 'Save & Next Lead',
  secondaryActionLabel = 'Save & Close',
}: DispositionModalProps) {
  const [internalDisposition, setInternalDisposition] = useState<DispositionType | null>(null)
  const [internalNotes, setInternalNotes] = useState('')
  const [markAsLead, setMarkAsLead] = useState(false)
  const [localSaving, setLocalSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  const isControlledDisposition = selectedDisposition !== undefined
  const isControlledNotes = notes !== undefined

  useEffect(() => {
    if (!open) return
    if (isControlledDisposition) setInternalDisposition(selectedDisposition ?? null)
    if (isControlledNotes) setInternalNotes(notes ?? '')
    if (!isControlledDisposition) setInternalDisposition(null)
    if (!isControlledNotes) setInternalNotes('')
    setMarkAsLead(false)
    setSaveError(null)
    setSaveNotice(null)
  }, [open, isControlledDisposition, selectedDisposition, isControlledNotes, notes])

  const activeDisposition = isControlledDisposition ? (selectedDisposition ?? null) : internalDisposition
  const activeNotes = isControlledNotes ? (notes ?? '') : internalNotes
  const canSave = Boolean(activeDisposition) && !isSaving && !localSaving

  const resolvedContact = useMemo(() => {
    const name = contact?.name || leadName || 'Unknown'
    return {
      name,
      phone: contact?.phone || phoneNumber || null,
      leadId: contact?.leadId ?? null,
      initials: contact?.initials || initialsFromName(name),
      avatarUrl: contact?.avatarUrl || null,
    }
  }, [contact, leadName, phoneNumber])

  if (!open) return null

  function pickDisposition(id: DispositionType) {
    if (!isControlledDisposition) setInternalDisposition(id)
    onDispositionChange?.(id)
    setSaveError(null)
    setSaveNotice(null)
  }

  function changeNotes(value: string) {
    if (!isControlledNotes) setInternalNotes(value)
    onNotesChange?.(value)
    setSaveNotice(null)
  }

  async function submit({ closeAfter, advance }: { closeAfter: boolean; advance: boolean }) {
    if (!activeDisposition || isSaving || localSaving) return
    setSaveError(null)
    setSaveNotice(null)
    setLocalSaving(true)
    try {
      const result = await onDisposition(activeDisposition, activeNotes.trim() || undefined, {
        markAsLead: markAsLeadAvailable && markAsLead,
        autoDialNext: advance,
      })
      if (result === false) {
        setSaveError('Disposition was not saved. Try again before moving on.')
        return
      }

      if (advance) onSaveAndNext?.()
      else onSave?.()

      setSaveNotice('Saved')
      if (closeAfter) onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Disposition was not saved. Try again.')
    } finally {
      setLocalSaving(false)
    }
  }

  if (variant === 'compact') {
    return (
      <div className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-[6px] flex items-start justify-center p-4 sm:pt-8" onClick={onClose}>
        <div
          className="w-full max-w-[380px] bg-[var(--skc-surface-1)] rounded-[var(--skc-radius-modal)] overflow-hidden"
          style={{ fontFamily: 'var(--skc-font)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-[60px_1fr_60px] items-center px-4 pt-3.5 pb-3">
            <button
              className="bg-transparent border-0 p-0 text-left text-[15px] tracking-[-0.01em] text-[#FF453A]"
              onClick={() => {
                onSkip?.()
                onClose()
              }}
            >
              Skip
            </button>
            <div className="text-center">
              <div className="text-white text-[17px] font-semibold tracking-[-0.02em]">Call Summary</div>
              <div className="text-[11px] font-medium text-[var(--skc-text-tertiary)] mt-0.5">
                {callEndedAtLabel}
                {callDuration ? ` · ${callDuration}` : ''}
              </div>
            </div>
            <button
              className={`bg-transparent border-0 p-0 text-right text-[15px] font-semibold tracking-[-0.01em] ${canSave ? 'text-[var(--skc-brand)]' : 'text-[var(--skc-text-quaternary)] cursor-not-allowed'}`}
              onClick={() => canSave && submit({ closeAfter: false, advance: false })}
              disabled={!canSave}
            >
              {isSaving || localSaving ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div className="px-4 pb-4">
            <div className="bg-[var(--skc-surface-soft)] rounded-[var(--skc-radius-card)] p-3.5 flex items-center gap-3">
              {resolvedContact.avatarUrl ? (
                <img src={resolvedContact.avatarUrl} alt="contact" className="w-11 h-11 rounded-full object-cover" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--skc-brand)] to-[#FF6B3D] text-white font-semibold text-[16px] tracking-[-0.01em] flex items-center justify-center">
                  {resolvedContact.initials}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="text-white text-[16px] font-semibold tracking-[-0.02em] truncate">{resolvedContact.name}</div>
                <div className="text-[13px] text-[var(--skc-text-tertiary)] mt-0.5 truncate">
                  {resolvedContact.phone || 'No phone'}
                  {resolvedContact.leadId ? ` · Lead #${resolvedContact.leadId}` : ''}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <ConnectionPill status={connectionStatus} />
                {connectionTimeLabel && (
                  <span className="text-[11px] text-[var(--skc-text-tertiary)] [font-feature-settings:'tnum']">
                    {connectionTimeLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 pb-2 flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-tertiary)]">Outcome</span>
            <span className="text-[12px] font-medium text-[#FF453A]">Required</span>
          </div>

          <div className="px-4">
            <div className="bg-[var(--skc-surface-2)] rounded-[var(--skc-radius-card)] overflow-hidden">
              {dispositions.map((d, i) => {
                const isLast = i === dispositions.length - 1
                const isSelected = d.id === activeDisposition
                return (
                  <button
                    key={d.id}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                    style={{ borderBottom: isLast ? 'none' : '0.5px solid var(--skc-separator)' }}
                    onClick={() => pickDisposition(d.id)}
                  >
                    <span className={`w-7 h-7 rounded-[var(--skc-radius-tile)] flex items-center justify-center ${TONE_TILE_CLASS[d.tone]}`}>
                      <Icon name={d.icon} size="text-[16px]" />
                    </span>
                    <span className="flex-1 text-white text-[16px] tracking-[-0.01em]">{d.label}</span>
                    {isSelected ? <CheckActive /> : d.hasSubreason ? <Chevron /> : <span className="w-[14px]" />}
                  </button>
                )
              })}
            </div>
          </div>

          {markAsLeadAvailable && (
            <div className="px-4 pt-4">
              <button
                type="button"
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-[var(--skc-radius-card)] border transition-colors ${
                  markAsLead
                    ? 'bg-[#30D1581F] border-[#30D15873]'
                    : 'bg-[var(--skc-surface-2)] border-transparent hover:bg-[var(--skc-surface-soft)]'
                }`}
                onClick={() => setMarkAsLead((value) => !value)}
              >
                <span className={`w-8 h-8 rounded-[var(--skc-radius-tile)] flex items-center justify-center ${
                  markAsLead ? 'bg-[#30D1582E] text-[#30D158]' : 'bg-[#98989E38] text-[var(--skc-text-secondary)]'
                }`}>
                  <Icon name={markAsLead ? 'check_circle' : 'person_add'} size="text-[18px]" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-white text-[16px] tracking-[-0.01em]">
                    {markAsLeadLabel || 'Mark as lead'}
                  </span>
                  <span className="block text-[12px] text-[var(--skc-text-tertiary)] mt-0.5">
                    Make this person the primary seller contact for the property.
                  </span>
                </span>
                {markAsLead ? <CheckActive /> : <span className="w-[22px]" />}
              </button>
            </div>
          )}

          {nextActions.length > 0 && (
            <>
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-tertiary)]">Next Action</span>
              </div>
              <div className="px-4">
                <div className="bg-[var(--skc-surface-2)] rounded-[var(--skc-radius-card)] overflow-hidden">
                  {nextActions.map((a, i) => {
                    const isLast = i === nextActions.length - 1
                    return (
                      <button
                        key={a.id}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                        style={{ borderBottom: isLast ? 'none' : '0.5px solid var(--skc-separator)' }}
                        onClick={() => onNextActionPick?.(a.id)}
                      >
                        <span className="w-[17px] h-[17px] inline-flex items-center justify-center">
                          <Icon name={a.icon} size="text-[16px]" className="text-[var(--skc-text-secondary)]" />
                        </span>
                        <span className="flex-1 text-white text-[16px] tracking-[-0.01em]">{a.label}</span>
                        {a.currentValueLabel && (
                          <span className="text-[15px] text-[var(--skc-text-tertiary)] tracking-[-0.01em]">{a.currentValueLabel}</span>
                        )}
                        <Chevron />
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          <div className="px-4 pt-4 pb-4">
            <div className="px-1 pb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-tertiary)]">Notes</div>
            <textarea
              className="w-full bg-[var(--skc-surface-2)] rounded-[var(--skc-radius-card)] border-0 outline-none p-3.5 min-h-[78px] text-white text-[15px] tracking-[-0.01em] placeholder:text-[var(--skc-text-tertiary)]"
              placeholder="Add notes from this call..."
              value={activeNotes}
              onChange={(e) => changeNotes(e.target.value)}
              rows={3}
            />

            {aiSummary && (
              <div className="mt-2.5 flex items-center gap-2 px-3 py-2 rounded-[var(--skc-radius-control)] bg-[var(--skc-brand-soft)] border border-[var(--skc-brand-soft-border)]">
                <Icon name="auto_awesome" size="text-[14px]" className="text-[#FF6B6B]" />
                <span className="flex-1 text-[13px] tracking-[-0.01em] text-[var(--skc-text-secondary)]">
                  AI summary ready from transcript
                </span>
                <button
                  className="bg-transparent border-0 p-0 text-[13px] font-medium text-[#FF6B6B]"
                  onClick={() => onUseAiSummary?.(aiSummary)}
                >
                  Use
                </button>
              </div>
            )}
            {saveError && (
              <div className="mt-2.5 flex items-start gap-2 px-3 py-2 rounded-[var(--skc-radius-control)] bg-[#FF453A1F] border border-[#FF453A66]">
                <Icon name="error" size="text-[14px]" className="text-[#FF453A] mt-0.5" />
                <span className="flex-1 text-[13px] tracking-[-0.01em] text-[#FFB4B4]">
                  {saveError}
                </span>
              </div>
            )}
          </div>

          <div className="px-4 pb-4">
            <button
              className="w-full py-3.5 rounded-[var(--skc-radius-card)] bg-[var(--skc-brand)] text-white text-[16px] font-semibold tracking-[-0.01em] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => submit({ closeAfter: true, advance: true })}
              disabled={!canSave}
            >
              {isSaving || localSaving ? 'Saving...' : 'Save & Next Lead'}
            </button>
            <button
              className="w-full py-3 mt-1.5 rounded-[var(--skc-radius-card)] bg-transparent text-[15px] font-medium tracking-[-0.01em] text-[var(--skc-text-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => submit({ closeAfter: true, advance: false })}
              disabled={!canSave}
            >
              Save & Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-[6px] flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-[860px] max-h-[calc(100vh-1.5rem)] bg-[var(--skc-surface-1)] rounded-[var(--skc-radius-modal)] overflow-hidden flex flex-col shadow-[0_28px_90px_rgba(0,0,0,0.62)]"
        style={{ fontFamily: 'var(--skc-font)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-[60px_1fr_60px] items-center px-4 pt-3.5 pb-3">
          <button
            className="bg-transparent border-0 p-0 text-left text-[15px] tracking-[-0.01em] text-[#FF453A]"
            onClick={() => {
              onSkip?.()
              onClose()
            }}
          >
            Skip
          </button>
          <div className="text-center">
            <div className="text-white text-[17px] font-semibold tracking-[-0.02em]">Call Summary</div>
            <div className="text-[11px] font-medium text-[var(--skc-text-tertiary)] mt-0.5">
              {callEndedAtLabel}
              {callDuration ? ` · ${callDuration}` : ''}
            </div>
          </div>
          <button
            className={`bg-transparent border-0 p-0 text-right text-[15px] font-semibold tracking-[-0.01em] ${canSave ? 'text-[var(--skc-brand)]' : 'text-[var(--skc-text-quaternary)] cursor-not-allowed'}`}
            onClick={() => canSave && submit({ closeAfter: true, advance: false })}
            disabled={!canSave}
          >
            {isSaving || localSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        <div className="px-4 pb-4 overflow-y-auto">
          <div className="bg-[var(--skc-surface-soft)] rounded-[var(--skc-radius-card)] p-3.5 flex items-center gap-3">
            {resolvedContact.avatarUrl ? (
              <img src={resolvedContact.avatarUrl} alt="contact" className="w-11 h-11 rounded-full object-cover" />
            ) : (
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--skc-brand)] to-[#FF6B3D] text-white font-semibold text-[16px] tracking-[-0.01em] flex items-center justify-center">
                {resolvedContact.initials}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="text-white text-[16px] font-semibold tracking-[-0.02em] truncate">{resolvedContact.name}</div>
              <div className="text-[13px] text-[var(--skc-text-tertiary)] mt-0.5 truncate">
                {resolvedContact.phone || 'No phone'}
                {resolvedContact.leadId ? ` · Lead #${resolvedContact.leadId}` : ''}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <ConnectionPill status={connectionStatus} />
              {connectionTimeLabel && (
                <span className="text-[11px] text-[var(--skc-text-tertiary)] [font-feature-settings:'tnum']">
                  {connectionTimeLabel}
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.75fr)] lg:items-start">
            <section className="min-w-0">
              <div className="pb-2 flex items-center justify-between">
                <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-tertiary)]">Outcome</span>
                <span className="text-[12px] font-medium text-[#FF453A]">Required</span>
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                {dispositions.map((d) => {
                  const isSelected = d.id === activeDisposition
                  return (
                    <button
                      key={d.id}
                      className={`min-h-[76px] rounded-[var(--skc-radius-card)] border px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? 'border-[var(--skc-brand)] bg-[var(--skc-brand-soft)]'
                          : 'border-[#2F2F38] bg-[var(--skc-surface-2)] hover:bg-[var(--skc-surface-soft)]'
                      }`}
                      onClick={() => pickDisposition(d.id)}
                    >
                      <span className="flex items-start gap-2.5">
                        <span className={`mt-0.5 w-8 h-8 rounded-[var(--skc-radius-tile)] flex items-center justify-center ${TONE_TILE_CLASS[d.tone]}`}>
                          <Icon name={d.icon} size="text-[17px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-white text-[14px] font-semibold leading-tight tracking-[-0.01em]">
                            {d.label}
                          </span>
                          {d.hasSubreason && (
                            <span className="mt-1 block text-[11px] text-[var(--skc-text-tertiary)]">
                              voicemail logged
                            </span>
                          )}
                        </span>
                        {isSelected ? <CheckActive /> : <span className="w-[22px]" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <aside className="min-w-0 space-y-4">
              {markAsLeadAvailable && (
                <button
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-[var(--skc-radius-card)] border transition-colors ${
                    markAsLead
                      ? 'bg-[#30D1581F] border-[#30D15873]'
                      : 'bg-[var(--skc-surface-2)] border-[#2F2F38] hover:bg-[var(--skc-surface-soft)]'
                  }`}
                  onClick={() => {
                    setMarkAsLead((value) => !value)
                    setSaveNotice(null)
                  }}
                >
                  <span className={`w-8 h-8 rounded-[var(--skc-radius-tile)] flex items-center justify-center ${
                    markAsLead ? 'bg-[#30D1582E] text-[#30D158]' : 'bg-[#98989E38] text-[var(--skc-text-secondary)]'
                  }`}>
                    <Icon name={markAsLead ? 'check_circle' : 'person_add'} size="text-[18px]" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white text-[14px] font-semibold tracking-[-0.01em]">
                      {markAsLeadLabel || 'Mark as lead'}
                    </span>
                    <span className="block text-[11px] text-[var(--skc-text-tertiary)] mt-0.5">
                      Make this person the primary seller contact.
                    </span>
                  </span>
                  {markAsLead ? <CheckActive /> : <span className="w-[22px]" />}
                </button>
              )}

              {nextActions.length > 0 && (
                <div>
                  <div className="pb-2 flex items-center justify-between">
                    <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-tertiary)]">Next Action</span>
                  </div>
                  <div className="bg-[var(--skc-surface-2)] rounded-[var(--skc-radius-card)] overflow-hidden border border-[#2F2F38]">
                    {nextActions.map((a, i) => {
                      const isLast = i === nextActions.length - 1
                      return (
                        <button
                          key={a.id}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left"
                          style={{ borderBottom: isLast ? 'none' : '0.5px solid var(--skc-separator)' }}
                          onClick={() => onNextActionPick?.(a.id)}
                        >
                          <span className="w-[17px] h-[17px] inline-flex items-center justify-center">
                            <Icon name={a.icon} size="text-[16px]" className="text-[var(--skc-text-secondary)]" />
                          </span>
                          <span className="flex-1 text-white text-[14px] tracking-[-0.01em]">{a.label}</span>
                          {a.currentValueLabel && (
                            <span className="text-[13px] text-[var(--skc-text-tertiary)] tracking-[-0.01em]">{a.currentValueLabel}</span>
                          )}
                          <Chevron />
                        </button>
                      )}
                    )}
                  </div>
                </div>
              )}

              <div>
                <div className="px-1 pb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-tertiary)]">Notes</div>
                <textarea
                  className="w-full bg-[var(--skc-surface-2)] rounded-[var(--skc-radius-card)] border border-[#2F2F38] outline-none p-3.5 min-h-[136px] text-white text-[15px] tracking-[-0.01em] placeholder:text-[var(--skc-text-tertiary)]"
                  placeholder="Add notes from this call..."
                  value={activeNotes}
                  onChange={(e) => changeNotes(e.target.value)}
                  rows={5}
                />

                {aiSummary && (
                  <div className="mt-2.5 flex items-center gap-2 px-3 py-2 rounded-[var(--skc-radius-control)] bg-[var(--skc-brand-soft)] border border-[var(--skc-brand-soft-border)]">
                    <Icon name="auto_awesome" size="text-[14px]" className="text-[#FF6B6B]" />
                    <span className="flex-1 text-[13px] tracking-[-0.01em] text-[var(--skc-text-secondary)]">
                      AI summary ready from transcript
                    </span>
                    <button
                      className="bg-transparent border-0 p-0 text-[13px] font-medium text-[#FF6B6B]"
                      onClick={() => onUseAiSummary?.(aiSummary)}
                    >
                      Use
                    </button>
                  </div>
                )}
                {saveNotice && (
                  <div className="mt-2.5 flex items-center gap-2 px-3 py-2 rounded-[var(--skc-radius-control)] bg-[#30D1581F] border border-[#30D15866]">
                    <Icon name="check_circle" size="text-[14px]" className="text-[#30D158]" />
                    <span className="flex-1 text-[13px] tracking-[-0.01em] text-[#B8F7C9]">
                      {saveNotice}
                    </span>
                  </div>
                )}
                {saveError && (
                  <div className="mt-2.5 flex items-start gap-2 px-3 py-2 rounded-[var(--skc-radius-control)] bg-[#FF453A1F] border border-[#FF453A66]">
                    <Icon name="error" size="text-[14px]" className="text-[#FF453A] mt-0.5" />
                    <span className="flex-1 text-[13px] tracking-[-0.01em] text-[#FFB4B4]">
                      {saveError}
                    </span>
                  </div>
                )}
              </div>
            </aside>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
            <button
              className="w-full py-3.5 rounded-[var(--skc-radius-card)] bg-[var(--skc-brand)] text-white text-[16px] font-semibold tracking-[-0.01em] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => submit({ closeAfter: true, advance: true })}
              disabled={!canSave}
            >
              {isSaving || localSaving ? 'Saving...' : primaryActionLabel}
            </button>
            <button
              className="w-full py-3.5 rounded-[var(--skc-radius-card)] bg-[var(--skc-surface-2)] border border-[#2F2F38] text-[15px] font-medium tracking-[-0.01em] text-[var(--skc-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => submit({ closeAfter: true, advance: false })}
              disabled={!canSave}
            >
              {secondaryActionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DispositionModal
