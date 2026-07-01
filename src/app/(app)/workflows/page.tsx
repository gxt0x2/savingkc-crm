'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { ScNav } from '@/components/smartercontact/sc-nav'
import { formatPhone } from '@/lib/format'

interface Workflow {
  id: string
  name: string
  status: 'active' | 'paused' | 'draft'
  trigger: 'manual' | 'on_reply' | 'on_group_add' | 'on_keyword'
  from_strategy: 'pool' | 'single'
  sending_number_ids: string[]
  enrolled_count: number
  day_span: number
  message_count: number
  active_count: number
}

interface StepDraft {
  delay_days: number
  delay_hours: number
  body: string
}

interface SendingNumber {
  id: string
  phone: string
  label: string | null
}

interface Group {
  id: string
  name: string
  contact_count: number
}

const TRIGGERS = [
  { value: 'manual', label: 'Manual enrollment' },
  { value: 'on_reply', label: 'On reply' },
  { value: 'on_group_add', label: 'On group add' },
  { value: 'on_keyword', label: 'On keyword' },
] as const

const MERGE_FIELDS = ['{first_name}', '{last_name}', '{address}', '{city}', '{state}']

const STATUS_STYLES: Record<Workflow['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  paused: 'bg-amber-500/15 text-amber-400',
  draft: 'bg-white/10 text-[var(--ck-text-muted)]',
}

function emptyStep(): StepDraft {
  return { delay_days: 0, delay_hours: 0, body: '' }
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showBuilder, setShowBuilder] = useState(false)
  const [editing, setEditing] = useState<Workflow | null>(null)

  const [enrollFor, setEnrollFor] = useState<Workflow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/sc/workflows')
      const json = await res.json()
      if (res.ok) setWorkflows(json.workflows || [])
      else setError(json.error || 'Failed to load')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggleStatus(w: Workflow) {
    const action = w.status === 'active' ? 'pause' : 'activate'
    await fetch(`/api/sc/workflows/${w.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    load()
  }

  async function remove(w: Workflow) {
    if (!confirm(`Delete workflow "${w.name}"? This stops all enrollments.`)) return
    await fetch(`/api/sc/workflows?id=${w.id}`, { method: 'DELETE' })
    load()
  }

  function openNew() {
    setEditing(null)
    setShowBuilder(true)
  }

  function openEdit(w: Workflow) {
    setEditing(w)
    setShowBuilder(true)
  }

  return (
    <div className="flex flex-col h-full">
      <ScNav />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-white">Contact workflows</h1>
            <p className="text-sm text-[var(--ck-text-dim)]">
              Automated multi-step SMS drip sequences.
            </p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-lg bg-[#E32E2E] text-white text-sm font-bold px-4 py-2 hover:bg-[#c72828]"
          >
            <Icon name="add" size="text-lg" /> Add new workflow
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-[#E32E2E]/10 px-4 py-2 text-sm text-[#E32E2E]">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-[var(--ck-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ck-border)] bg-[var(--ck-surface)] text-left text-[var(--ck-text-dim)]">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Active contacts</th>
                <th className="px-4 py-3 font-semibold text-right">Days</th>
                <th className="px-4 py-3 font-semibold text-right">Messages</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--ck-text-dim)]">
                    Loading…
                  </td>
                </tr>
              ) : workflows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[var(--ck-text-dim)]">
                    No workflows yet. Create one to start dripping messages.
                  </td>
                </tr>
              ) : (
                workflows.map((w) => (
                  <tr
                    key={w.id}
                    className="border-b border-[var(--ck-border)] last:border-0 hover:bg-white/5"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--ck-text)]">{w.name}</div>
                      <div className="text-xs text-[var(--ck-text-dim)]">
                        {TRIGGERS.find((t) => t.value === w.trigger)?.label || w.trigger}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[w.status]}`}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--ck-text)]">{w.active_count}</td>
                    <td className="px-4 py-3 text-right text-[var(--ck-text)]">{w.day_span}</td>
                    <td className="px-4 py-3 text-right text-[var(--ck-text)]">{w.message_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEnrollFor(w)}
                          title="Enroll contacts"
                          className="p-1.5 rounded-md hover:bg-white/10 text-[var(--ck-text-muted)]"
                        >
                          <Icon name="group_add" size="text-lg" />
                        </button>
                        <button
                          onClick={() => toggleStatus(w)}
                          title={w.status === 'active' ? 'Pause' : 'Activate'}
                          className="p-1.5 rounded-md hover:bg-white/10 text-[var(--ck-text-muted)]"
                        >
                          <Icon name={w.status === 'active' ? 'pause' : 'play_arrow'} size="text-lg" />
                        </button>
                        <button
                          onClick={() => openEdit(w)}
                          title="Edit"
                          className="p-1.5 rounded-md hover:bg-white/10 text-[var(--ck-text-muted)]"
                        >
                          <Icon name="edit" size="text-lg" />
                        </button>
                        <button
                          onClick={() => remove(w)}
                          title="Delete"
                          className="p-1.5 rounded-md hover:bg-white/10 text-[#E32E2E]"
                        >
                          <Icon name="delete" size="text-lg" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showBuilder && (
        <WorkflowBuilder
          workflow={editing}
          onClose={() => setShowBuilder(false)}
          onSaved={() => {
            setShowBuilder(false)
            load()
          }}
        />
      )}

      {enrollFor && (
        <EnrollModal
          workflow={enrollFor}
          onClose={() => setEnrollFor(null)}
          onDone={() => {
            setEnrollFor(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- builder */

function WorkflowBuilder({
  workflow,
  onClose,
  onSaved,
}: {
  workflow: Workflow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(workflow?.name || '')
  const [trigger, setTrigger] = useState<Workflow['trigger']>(workflow?.trigger || 'manual')
  const [numberIds, setNumberIds] = useState<string[]>(workflow?.sending_number_ids || [])
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()])
  const [numbers, setNumbers] = useState<SendingNumber[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/sc/numbers')
      .then((r) => r.json())
      .then((j) => setNumbers(j.numbers || []))
      .catch(() => {})
  }, [])

  // When editing, load the existing steps.
  useEffect(() => {
    if (!workflow) return
    fetch(`/api/sc/workflows/${workflow.id}`)
      .then((r) => r.json())
      .then((j) => {
        const loaded = (j.steps || []).map((s: StepDraft) => ({
          delay_days: s.delay_days || 0,
          delay_hours: s.delay_hours || 0,
          body: s.body || '',
        }))
        setSteps(loaded.length ? loaded : [emptyStep()])
      })
      .catch(() => {})
  }, [workflow])

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addStep() {
    setSteps((prev) => [...prev, emptyStep()])
  }
  function removeStep(i: number) {
    setSteps((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }
  function moveStep(i: number, dir: -1 | 1) {
    setSteps((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function insertMerge(i: number, field: string) {
    setSteps((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, body: `${s.body}${field}` } : s)),
    )
  }
  function toggleNumber(id: string) {
    setNumberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // Cumulative day label per step (SmarterContact "Day N").
  function cumulativeDay(index: number): number {
    let d = 0
    for (let k = 0; k <= index; k++) d += steps[k]?.delay_days || 0
    return d
  }

  async function save() {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!steps.some((s) => s.body.trim())) {
      setError('Add at least one message')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      name: name.trim(),
      trigger,
      from_strategy: 'pool' as const,
      sending_number_ids: numberIds,
      steps: steps
        .filter((s) => s.body.trim())
        .map((s) => ({
          delay_days: Number(s.delay_days) || 0,
          delay_hours: Number(s.delay_hours) || 0,
          body: s.body.trim(),
        })),
    }
    try {
      const res = workflow
        ? await fetch('/api/sc/workflows', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: workflow.id, ...payload }),
          })
        : await fetch('/api/sc/workflows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const json = await res.json()
      if (!res.ok) setError(json.error || 'Save failed')
      else onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-end">
      <div className="w-full max-w-2xl h-full overflow-y-auto bg-[var(--ck-bg)] border-l border-[var(--ck-border)] flex flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--ck-border)] bg-[var(--ck-bg)] px-6 py-4">
          <h2 className="text-lg font-bold text-white">
            {workflow ? 'Edit workflow' : 'New workflow'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/10 text-[var(--ck-text-muted)]"
          >
            <Icon name="close" size="text-xl" />
          </button>
        </header>

        <div className="flex-1 p-6 flex flex-col gap-5">
          <div>
            <label className="block text-xs font-semibold text-[var(--ck-text-dim)] mb-1">
              Workflow name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cold lead 30-day drip"
              className="w-full rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ck-text-dim)] mb-1">
              Trigger
            </label>
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as Workflow['trigger'])}
              className="w-full rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
            >
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ck-text-dim)] mb-1">
              Sending numbers (pool)
            </label>
            {numbers.length === 0 ? (
              <div className="text-xs text-[var(--ck-text-dim)]">No sending numbers configured.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {numbers.map((n) => {
                  const on = numberIds.includes(n.id)
                  return (
                    <button
                      key={n.id}
                      onClick={() => toggleNumber(n.id)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                        on
                          ? 'bg-[#E32E2E]/15 border-[#E32E2E] text-white'
                          : 'border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:bg-white/5'
                      }`}
                    >
                      {n.label || formatPhone(n.phone)}
                    </button>
                  )
                })}
              </div>
            )}
            <p className="mt-1 text-xs text-[var(--ck-text-dim)]">
              Leave empty to rotate any healthy number in the pool.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[var(--ck-text-dim)]">Steps</label>
              <button
                onClick={addStep}
                className="flex items-center gap-1 text-xs font-semibold text-[#E32E2E] hover:underline"
              >
                <Icon name="add" size="text-base" /> Add step
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {steps.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">Day {cumulativeDay(i)}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveStep(i, -1)}
                        disabled={i === 0}
                        className="p-1 rounded hover:bg-white/10 text-[var(--ck-text-muted)] disabled:opacity-30"
                        title="Move up"
                      >
                        <Icon name="arrow_upward" size="text-base" />
                      </button>
                      <button
                        onClick={() => moveStep(i, 1)}
                        disabled={i === steps.length - 1}
                        className="p-1 rounded hover:bg-white/10 text-[var(--ck-text-muted)] disabled:opacity-30"
                        title="Move down"
                      >
                        <Icon name="arrow_downward" size="text-base" />
                      </button>
                      <button
                        onClick={() => removeStep(i)}
                        disabled={steps.length === 1}
                        className="p-1 rounded hover:bg-white/10 text-[#E32E2E] disabled:opacity-30"
                        title="Remove"
                      >
                        <Icon name="delete" size="text-base" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mb-2">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--ck-text-muted)]">
                      Wait
                      <input
                        type="number"
                        min={0}
                        value={s.delay_days}
                        onChange={(e) =>
                          updateStep(i, { delay_days: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="w-16 rounded bg-[var(--ck-bg)] border border-[var(--ck-border)] px-2 py-1 text-sm text-[var(--ck-text)] outline-none"
                      />
                      days
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--ck-text-muted)]">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={s.delay_hours}
                        onChange={(e) =>
                          updateStep(i, { delay_hours: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="w-16 rounded bg-[var(--ck-bg)] border border-[var(--ck-border)] px-2 py-1 text-sm text-[var(--ck-text)] outline-none"
                      />
                      hours
                    </label>
                  </div>

                  <textarea
                    value={s.body}
                    onChange={(e) => updateStep(i, { body: e.target.value })}
                    rows={3}
                    placeholder="Message body — supports {first_name} and spintax {Hi|Hey}"
                    className="w-full resize-none rounded-lg bg-[var(--ck-bg)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {MERGE_FIELDS.map((f) => (
                      <button
                        key={f}
                        onClick={() => insertMerge(i, f)}
                        className="rounded border border-[var(--ck-border)] px-2 py-0.5 text-xs text-[var(--ck-text-muted)] hover:bg-white/5"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <div className="text-sm text-[#E32E2E]">{error}</div>}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[var(--ck-border)] bg-[var(--ck-bg)] px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[#E32E2E] text-white text-sm font-bold px-5 py-2 hover:bg-[#c72828] disabled:opacity-40"
          >
            {saving ? 'Saving…' : workflow ? 'Save changes' : 'Create workflow'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ enroll modal */

function EnrollModal({
  workflow,
  onClose,
  onDone,
}: {
  workflow: Workflow
  onClose: () => void
  onDone: () => void
}) {
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string>('')

  useEffect(() => {
    fetch('/api/sc/groups')
      .then((r) => r.json())
      .then((j) => setGroups(j.groups || []))
      .catch(() => {})
  }, [])

  async function enroll() {
    if (!groupId) {
      setError('Pick a group')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/sc/workflows/${workflow.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enroll', group_id: groupId }),
      })
      const json = await res.json()
      if (!res.ok) setError(json.error || 'Enroll failed')
      else setResult(`Enrolled ${json.enrolled}, skipped ${json.skipped} already enrolled.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enroll failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-xl bg-[var(--ck-bg)] border border-[var(--ck-border)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-white mb-1">Enroll contacts</h3>
        <p className="text-xs text-[var(--ck-text-dim)] mb-4">Into "{workflow.name}"</p>

        <label className="block text-xs font-semibold text-[var(--ck-text-dim)] mb-1">Group</label>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-full mb-3 rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
        >
          <option value="">Select a group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.contact_count})
            </option>
          ))}
        </select>

        {error && <div className="mb-2 text-xs text-[#E32E2E]">{error}</div>}
        {result && <div className="mb-2 text-xs text-emerald-400">{result}</div>}

        <div className="flex justify-end gap-2">
          <button
            onClick={result ? onDone : onClose}
            className="px-3 py-2 text-sm text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
          >
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={enroll}
              disabled={submitting || !groupId}
              className="rounded-lg bg-[#E32E2E] text-white text-sm font-bold px-4 py-2 hover:bg-[#c72828] disabled:opacity-40"
            >
              {submitting ? 'Enrolling…' : 'Enroll'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
