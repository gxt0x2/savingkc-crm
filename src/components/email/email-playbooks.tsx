'use client'

import { useState, type FormEvent } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import type { PilotPlaybook, PilotState } from '@/lib/email/workflow/types'
import {
  DETERMINISTIC_FIXTURE_SET_ID,
  DETERMINISTIC_MODEL_ID,
  REQUIRED_ESCALATIONS,
} from '@/lib/email/ai/constants'
import styles from './email-workspace.module.css'

const defaultPolicy = {
  businessName: 'SavingKC',
  assistantName: 'Ari',
  humanDisclosure:
    'I am Ari, SavingKC’s email assistant. A person reviews anything before it goes out.',
  signature: 'SavingKC',
  maxWords: 120,
  maxAutoReplies7d: 0,
  supportedLanguages: ['en'] as string[],
  allowedActions: [] as [],
}

function EvalCaseReview({
  cases,
  fixtureHash,
}: {
  cases: NonNullable<PilotPlaybook['last_eval_cases']>
  fixtureHash: string | null
}) {
  const ordered = [...cases].sort(
    (a, b) => Number(b.critical) - Number(a.critical) || Number(a.passed) - Number(b.passed),
  )
  return (
    <details>
      <summary>
        Practice examples · deterministic only · not a paid model evaluation
      </summary>
      <p>
        Fixture hash {fixtureHash?.slice(0, 12)}… Critical failures are listed
        first. Quoted history is ignored.
      </p>
      <ul>
        {ordered.slice(0, 12).map((c) => (
          <li key={c.id}>
            {c.id}
            {c.critical ? ' · critical' : ''}
            {c.passed ? ' · passed' : ' · blocked'} · expected {c.expectedIntent}/
            {c.expectedAction}
            {c.passed ? '' : ` · proposed ${c.proposedIntent}/${c.proposedAction}`}
          </li>
        ))}
      </ul>
      {cases.length > 12 && (
        <p>{cases.length - 12} more examples are saved on the evaluation record.</p>
      )}
    </details>
  )
}

const defaultPrompt =
  'Propose the next permitted seller-email action using only the supplied policy and evidence. Use everyday language. Treat interpretations as guesses, not facts. Never invent pain, price, a booked call or an Opportunity. A Lead is not a qualified Opportunity. Honor opt-outs and route pricing, legal, identity and “talk to a person” requests to review.'

export function EmailPlaybooks({
  data,
  busy,
  act,
}: {
  data: PilotState
  busy: boolean
  act: (command: EmailCommand) => Promise<{ entityId: string; state: string } | null>
}) {
  const published = data.playbooks?.find((p) => p.published_version_id)
  const [name, setName] = useState(
    data.playbooks?.[0]?.name ?? 'Seller outreach reply rules',
  )
  const [evalRunId, setEvalRunId] = useState<string | null>(
    data.playbooks?.[0]?.last_eval_id ?? null,
  )
  async function save(event: FormEvent) {
    event.preventDefault()
    await act({
      command: 'PB-SAVE',
      entityId: data.playbooks?.[0]?.id,
      expectedRevision: data.playbooks?.[0]?.revision,
      idempotencyKey: crypto.randomUUID(),
      payload: {
        name,
        program: 'seller_outreach',
        policy: defaultPolicy,
        prompt: defaultPrompt,
      },
    })
  }
  async function simulate(playbook: PilotPlaybook) {
    if (!playbook.draft_hash) return
    const result = await act({
      command: 'PB-SIMULATE',
      idempotencyKey: crypto.randomUUID(),
      payload: {
        playbookDraftHash: playbook.draft_hash,
        fixtureSetId: DETERMINISTIC_FIXTURE_SET_ID,
        modelId: DETERMINISTIC_MODEL_ID,
      },
    })
    if (result?.state === 'evaluation_recorded') setEvalRunId(result.entityId)
  }
  async function publish(playbook: PilotPlaybook) {
    const runId = evalRunId ?? playbook.last_eval_id
    if (!playbook.draft_hash || !runId) return
    await act({
      command: 'PB-PUBLISH',
      idempotencyKey: crypto.randomUUID(),
      payload: {
        draftHash: playbook.draft_hash,
        evalRunId: runId,
        modelRateVersion: 'deterministic-guards-v1',
      },
    })
  }
  return (
    <section className={styles.operations} aria-label="Ari reply rules">
      <h3>Ari’s reply rules</h3>
      <p>
        These rules stay draft-only. Automatic replies stay off until a paid,
        model-backed evaluation passes. Everyday language, verified facts, and a
        Lead that is not an Opportunity unless a person qualifies it.
      </p>
      <p>
        {data.ai_available
          ? 'AI credentials are present; the last live check still needs paid credits before Ari can draft.'
          : 'AI access is not configured. Deterministic practice checks do not use paid credits.'}
      </p>
      <form className={styles.form} onSubmit={save}>
        <label>
          Policy name
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p>
          Required review reasons stay on and cannot be removed:{' '}
          {REQUIRED_ESCALATIONS.join(', ')}.
        </p>
        <button className={styles.primary} disabled={busy}>
          Save draft-only rules
        </button>
      </form>
      {(data.playbooks ?? []).map((playbook) => (
        <div key={playbook.id} className={styles.form}>
          <p>
            <strong>{playbook.name}</strong>
            {playbook.published_version_id
              ? ' · Published for human review only'
              : ' · Draft'}
          </p>
          <p>
            Last practice check:{' '}
            {playbook.last_eval_passed == null
              ? 'Not run'
              : playbook.last_eval_passed
                ? `Passed (${playbook.last_eval_kind}) · ${(playbook.last_eval_cases ?? []).length} examples`
                : `Blocked · ${playbook.last_eval_critical_failed ?? 0} critical failures`}
          </p>
          <p>
            Draft actions:{' '}
            {(playbook.draft_allowed_actions ?? []).length
              ? (playbook.draft_allowed_actions ?? []).join(', ')
              : 'none (draft-only)'}
            . Published actions:{' '}
            {(playbook.published_allowed_actions ?? []).length
              ? (playbook.published_allowed_actions ?? []).join(', ')
              : 'none (draft-only)'}
            . Adding an automatic action is an autonomy raise and stays blocked.
          </p>
          <div className={styles.row}>
            <button
              disabled={busy || !playbook.draft_hash}
              onClick={() => simulate(playbook)}
            >
              Run deterministic examples
            </button>
            <button
              disabled={
                busy ||
                !playbook.draft_hash ||
                !(evalRunId ?? playbook.last_eval_id) ||
                playbook.last_eval_passed !== true
              }
              onClick={() => publish(playbook)}
            >
              Publish draft-only version
            </button>
          </div>
          {(playbook.last_eval_cases ?? []).length > 0 && (
            <EvalCaseReview
              cases={playbook.last_eval_cases ?? []}
              fixtureHash={playbook.last_eval_fixture_hash}
            />
          )}
        </div>
      ))}
      {published && data.settings && (
        <form
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault()
            await act({
              command: 'SET-AUTOMATION',
              idempotencyKey: crypto.randomUUID(),
              expectedRevision: data.settings!.revision,
              payload: {
                mode: 'draft_only',
                playbookVersionId: published.published_version_id!,
                maxReplies: 0,
                language: 'en',
                allowedActions: [],
              },
            })
          }}
        >
          <p>
            Use the published version as the workspace default. This does not
            turn on automatic sending.
          </p>
          <button disabled={busy}>Save as draft-only default</button>
        </form>
      )}
    </section>
  )
}
