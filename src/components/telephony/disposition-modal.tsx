'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import {
  DIALER_DISPOSITIONS,
  DEAD_REASONS,
  dispositionRequiresReason,
  isReachedDisposition,
  type DispositionId,
  type DispositionTone,
} from '@/lib/dialer-dispositions'
import type { DialerPostCallStatus } from '@/lib/dialer-post-call-review'

// Canonical disposition ids live in src/lib/dialer-dispositions.ts so the modal,
// the heir panel, and the lead PATCH route all speak the same language.
export type DispositionType = DispositionId

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
    options?: { markAsLead?: boolean; autoDialNext?: boolean; verified?: boolean; deadReason?: string | null; appointmentAt?: string | null },
  ) => void | boolean | Promise<void | boolean>
  phoneNumber?: string
  leadName?: string
  markAsLeadAvailable?: boolean
  markAsLeadLabel?: string
  /** Show the manual "verified this is the right number" toggle (heir queue). */
  showVerifyToggle?: boolean
  verifyLabel?: string

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
  aiSummaryStatus?: DialerPostCallStatus | null
  onUseAiSummary?: (summary: string) => void

  onSave?: () => void
  onSaveAndNext?: () => void
  isSaving?: boolean
  contact?: ContactSummary
  variant?: 'standard' | 'heirQueue' | 'compact'
  primaryActionLabel?: string
  secondaryActionLabel?: string
}

// Built from the single source of truth so the outcome grid always matches the
// taxonomy the rest of the dialer reads.
const DEFAULT_DISPOSITIONS: DispositionOption[] = DIALER_DISPOSITIONS.map((d) => ({
  id: d.id,
  label: d.label,
  tone: d.tone,
  icon: d.icon,
  hasSubreason: d.requiresReason,
}))

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

function AppointmentDateTimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="px-4 pt-4">
      <label className="block rounded-[var(--skc-radius-card)] border border-[var(--skc-brand-soft-border)] bg-[var(--skc-brand-soft)] p-3">
        <span className="flex items-center justify-between pb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-secondary)]">
          Appointment date and time
          <span className="text-[#FF453A]">Required</span>
        </span>
        <input
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-[var(--skc-radius-control)] border border-[var(--skc-separator)] bg-[var(--skc-surface-2)] px-3 py-2.5 text-[15px] text-white outline-none focus:border-[var(--skc-brand)]"
        />
        <span className="mt-2 block text-[12px] text-[var(--skc-text-tertiary)]">The CRM will save this exact time. It will not invent a placeholder appointment.</span>
      </label>
    </div>
  )
}

function AiReviewPrompt({
  status,
  summary,
  onUse,
}: {
  status?: DialerPostCallStatus | null
  summary?: string | null
  onUse: () => void
}) {
  if (status === 'processing' || status === 'not_requested') {
    return <p role="status" className="mt-2.5 rounded-[var(--skc-radius-control)] border border-[var(--skc-brand-soft-border)] bg-[var(--skc-brand-soft)] px-3 py-2 text-[12px] text-[var(--skc-text-secondary)]">AI review is processing. Save the outcome without waiting.</p>
  }
  if (status === 'unavailable') {
    return <p role="alert" className="mt-2.5 rounded-[var(--skc-radius-control)] border border-[#FF9F0A55] bg-[#FF9F0A14] px-3 py-2 text-[12px] text-[#FFD28A]">AI review was unavailable. Your disposition still saves normally.</p>
  }
  if (!summary) return null
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-[var(--skc-radius-control)] border border-[var(--skc-brand-soft-border)] bg-[var(--skc-brand-soft)] px-3 py-2">
      <Icon name="auto_awesome" size="text-[14px]" className="text-[#FF6B6B]" />
      <span className="flex-1 text-[13px] tracking-[-0.01em] text-[var(--skc-text-secondary)]">AI summary ready from transcript</span>
      <button type="button" className="bg-transparent p-0 text-[13px] font-medium text-[#FF6B6B]" onClick={onUse}>Use</button>
    </div>
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
  showVerifyToggle = false,
  verifyLabel,
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
  aiSummaryStatus = null,
  onUseAiSummary,
  onSave,
  onSaveAndNext,
  isSaving = false,
  contact,
  variant = 'standard',
  primaryActionLabel = 'Save & Next Lead',
  secondaryActionLabel = 'Save & Close',
}: DispositionModalProps) {
  const [internalDisposition, setInternalDisposition] = useState<DispositionType | null>(null)
  const [internalNotes, setInternalNotes] = useState('')
  const [markAsLead, setMarkAsLead] = useState(false)
  const [deadReason, setDeadReason] = useState('')
  const [verified, setVerified] = useState(false)
  // Whether the agent explicitly touched the verify toggle. If untouched we
  // send `undefined` so the server auto-verifies on a reached outcome and
  // leaves the flag alone otherwise (a later "No Answer" must not un-verify a
  // number we already confirmed). A touch makes it an explicit manual override.
  const [verifiedTouched, setVerifiedTouched] = useState(false)
  const [appointmentAt, setAppointmentAt] = useState('')
  const [localSaving, setLocalSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const savingRef = useRef(false)

  const isControlledDisposition = selectedDisposition !== undefined
  const isControlledNotes = notes !== undefined
  const autoSubmitOnOutcome = variant === 'heirQueue'

  useEffect(() => {
    if (!open) return
    if (isControlledDisposition) setInternalDisposition(selectedDisposition ?? null)
    if (isControlledNotes) setInternalNotes(notes ?? '')
    if (!isControlledDisposition) setInternalDisposition(null)
    if (!isControlledNotes) setInternalNotes('')
    setMarkAsLead(false)
    setDeadReason('')
    setVerified(false)
    setVerifiedTouched(false)
    setAppointmentAt('')
    setSaveError(null)
    setSaveNotice(null)
  }, [open, isControlledDisposition, selectedDisposition, isControlledNotes, notes])

  const activeDisposition = isControlledDisposition ? (selectedDisposition ?? null) : internalDisposition
  const activeNotes = isControlledNotes ? (notes ?? '') : internalNotes
  const needsReason = dispositionRequiresReason(activeDisposition)
  const reasonSatisfied = !needsReason || (
    deadReason.trim().length > 0 && (deadReason !== 'other' || activeNotes.trim().length > 0)
  )
  const appointmentSatisfied = activeDisposition !== 'appointment_set' || Boolean(appointmentAt)
  const canSave = Boolean(activeDisposition) && reasonSatisfied && appointmentSatisfied && !isSaving && !localSaving

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
    // Default the verified signal to match the outcome (reached → verified);
    // the agent can still override it with the toggle below. Re-picking resets
    // the "touched" flag so an untouched toggle stays auto.
    setVerified(isReachedDisposition(id))
    setVerifiedTouched(false)
    if (!dispositionRequiresReason(id)) setDeadReason('')
    setSaveError(null)
    setSaveNotice(null)
    if (autoSubmitOnOutcome && !dispositionRequiresReason(id) && id !== 'appointment_set') {
      void submit({ closeAfter: true, advance: true, disposition: id })
    }
  }

  function changeNotes(value: string) {
    if (!isControlledNotes) setInternalNotes(value)
    onNotesChange?.(value)
    setSaveNotice(null)
  }

  function useAiSummary() {
    if (!aiSummary || activeNotes.includes(aiSummary)) return
    changeNotes(activeNotes.trim() ? `${activeNotes.trim()}\n\n${aiSummary}` : aiSummary)
    onUseAiSummary?.(aiSummary)
  }

  async function submit({
    closeAfter,
    advance,
    disposition = activeDisposition,
    deadReason: deadReasonOverride,
  }: {
    closeAfter: boolean
    advance: boolean
    disposition?: DispositionType | null
    deadReason?: string
  }) {
    if (!disposition || isSaving || localSaving || savingRef.current) return
    const dispositionNeedsReason = dispositionRequiresReason(disposition)
    const resolvedDeadReason = deadReasonOverride ?? deadReason
    if (dispositionNeedsReason && !resolvedDeadReason.trim()) {
      setSaveError('Choose a reason before marking this lead dead.')
      return
    }
    if (dispositionNeedsReason && resolvedDeadReason === 'other' && !activeNotes.trim()) {
      setSaveError('Add a note when Other is selected.')
      return
    }
    if (disposition === 'appointment_set' && !appointmentAt) {
      setSaveError('Choose the appointment date and time before saving.')
      return
    }
    savingRef.current = true
    setSaveError(null)
    setSaveNotice(null)
    setLocalSaving(true)
    try {
      const result = await onDisposition(disposition, activeNotes.trim() || undefined, {
        markAsLead: markAsLeadAvailable && markAsLead,
        autoDialNext: advance,
        verified: showVerifyToggle && verifiedTouched ? verified : undefined,
        deadReason: dispositionNeedsReason ? resolvedDeadReason : undefined,
        appointmentAt: disposition === 'appointment_set' && appointmentAt
          ? new Date(appointmentAt).toISOString()
          : undefined,
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
      savingRef.current = false
      setLocalSaving(false)
    }
  }

  function pickDeadReason(reasonId: string) {
    setDeadReason(reasonId)
    setSaveError(null)
    if (autoSubmitOnOutcome && reasonId !== 'other' && activeDisposition && dispositionRequiresReason(activeDisposition)) {
      void submit({
        closeAfter: true,
        advance: true,
        disposition: activeDisposition,
        deadReason: reasonId,
      })
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
                // eslint-disable-next-line @next/next/no-img-element
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

          {showVerifyToggle && (
            <div className="px-4 pt-4">
              <button
                type="button"
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-[var(--skc-radius-card)] border transition-colors ${
                  verified
                    ? 'bg-[#30D1581F] border-[#30D15873]'
                    : 'bg-[var(--skc-surface-2)] border-transparent hover:bg-[var(--skc-surface-soft)]'
                }`}
                onClick={() => { setVerified((value) => !value); setVerifiedTouched(true) }}
              >
                <span className={`w-8 h-8 rounded-[var(--skc-radius-tile)] flex items-center justify-center ${
                  verified ? 'bg-[#30D1582E] text-[#30D158]' : 'bg-[#98989E38] text-[var(--skc-text-secondary)]'
                }`}>
                  <Icon name={verified ? 'verified' : 'verified_user'} size="text-[18px]" filled={verified} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-white text-[16px] tracking-[-0.01em]">
                    {verifyLabel || 'Verified number'}
                  </span>
                  <span className="block text-[12px] text-[var(--skc-text-tertiary)] mt-0.5">
                    Confirm this number really belongs to this heir.
                  </span>
                </span>
                {verified ? <CheckActive /> : <span className="w-[22px]" />}
              </button>
            </div>
          )}

          {activeDisposition === 'appointment_set' && (
            <AppointmentDateTimeField value={appointmentAt} onChange={setAppointmentAt} />
          )}

          {needsReason && (
            <div className="px-4 pt-4">
              <div className="rounded-[var(--skc-radius-card)] border border-[#FF453A66] bg-[#FF453A14] p-3">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#FF8A80]">Why is it dead?</span>
                  <span className="text-[12px] font-medium text-[#FF453A]">Required</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {DEAD_REASONS.map((reason) => {
                    const isPicked = deadReason === reason.id
                    return (
                      <button
                        key={reason.id}
                        type="button"
                        onClick={() => pickDeadReason(reason.id)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-[var(--skc-radius-control)] text-left text-[15px] tracking-[-0.01em] transition-colors ${
                          isPicked
                            ? 'bg-[#FF453A2E] text-white'
                            : 'bg-[var(--skc-surface-2)] text-[var(--skc-text-secondary)] hover:bg-[var(--skc-surface-soft)]'
                        }`}
                      >
                        <Icon
                          name={isPicked ? 'radio_button_checked' : 'radio_button_unchecked'}
                          size="text-[16px]"
                          className={isPicked ? 'text-[#FF453A]' : 'text-[var(--skc-text-quaternary)]'}
                        />
                        {reason.label}
                      </button>
                    )
                  })}
                </div>
              </div>
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

            <AiReviewPrompt status={aiSummaryStatus} summary={aiSummary} onUse={useAiSummary} />
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
            {!autoSubmitOnOutcome && (
              <>
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
              </>
            )}
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
          {autoSubmitOnOutcome ? (
            <div />
          ) : (
            <button
              className={`bg-transparent border-0 p-0 text-right text-[15px] font-semibold tracking-[-0.01em] ${canSave ? 'text-[var(--skc-brand)]' : 'text-[var(--skc-text-quaternary)] cursor-not-allowed'}`}
              onClick={() => canSave && submit({ closeAfter: true, advance: false })}
              disabled={!canSave}
            >
              {isSaving || localSaving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>

        <div className="px-4 pb-4 overflow-y-auto">
          <div className="bg-[var(--skc-surface-soft)] rounded-[var(--skc-radius-card)] p-3.5 flex items-center gap-3">
            {resolvedContact.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
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
                            <span className="mt-1 block text-[11px] text-[#FF9F0A]">
                              reason required
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

              {showVerifyToggle && (
                <button
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-[var(--skc-radius-card)] border transition-colors ${
                    verified
                      ? 'bg-[#30D1581F] border-[#30D15873]'
                      : 'bg-[var(--skc-surface-2)] border-[#2F2F38] hover:bg-[var(--skc-surface-soft)]'
                  }`}
                  onClick={() => {
                    setVerified((value) => !value)
                    setVerifiedTouched(true)
                    setSaveNotice(null)
                  }}
                >
                  <span className={`w-8 h-8 rounded-[var(--skc-radius-tile)] flex items-center justify-center ${
                    verified ? 'bg-[#30D1582E] text-[#30D158]' : 'bg-[#98989E38] text-[var(--skc-text-secondary)]'
                  }`}>
                    <Icon name={verified ? 'verified' : 'verified_user'} size="text-[18px]" filled={verified} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white text-[14px] font-semibold tracking-[-0.01em]">
                      {verifyLabel || 'Verified number'}
                    </span>
                    <span className="block text-[11px] text-[var(--skc-text-tertiary)] mt-0.5">
                      Confirm this number really belongs to this heir.
                    </span>
                  </span>
                  {verified ? <CheckActive /> : <span className="w-[22px]" />}
                </button>
              )}

              {activeDisposition === 'appointment_set' && (
                <AppointmentDateTimeField value={appointmentAt} onChange={setAppointmentAt} />
              )}

              {needsReason && (
                <div className="rounded-[var(--skc-radius-card)] border border-[#FF453A66] bg-[#FF453A14] p-3">
                  <div className="flex items-center justify-between pb-2">
                    <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#FF8A80]">Why is it dead?</span>
                    <span className="text-[12px] font-medium text-[#FF453A]">Required</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {DEAD_REASONS.map((reason) => {
                      const isPicked = deadReason === reason.id
                      return (
                        <button
                          key={reason.id}
                          type="button"
                          onClick={() => pickDeadReason(reason.id)}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-[var(--skc-radius-control)] text-left text-[14px] tracking-[-0.01em] transition-colors ${
                            isPicked
                              ? 'bg-[#FF453A2E] text-white'
                              : 'bg-[var(--skc-surface-2)] text-[var(--skc-text-secondary)] hover:bg-[var(--skc-surface-soft)]'
                          }`}
                        >
                          <Icon
                            name={isPicked ? 'radio_button_checked' : 'radio_button_unchecked'}
                            size="text-[16px]"
                            className={isPicked ? 'text-[#FF453A]' : 'text-[var(--skc-text-quaternary)]'}
                          />
                          {reason.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
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

                <AiReviewPrompt status={aiSummaryStatus} summary={aiSummary} onUse={useAiSummary} />
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

          {!autoSubmitOnOutcome && (
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
          )}
        </div>
      </div>
    </div>
  )
}

export default DispositionModal
