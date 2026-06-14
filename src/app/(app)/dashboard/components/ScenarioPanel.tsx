'use client'

import { useEffect, useState } from 'react'

import { ConversionRow } from './ConversionRow'
import { CONVERSION_STAGES, type ConversionStage, type ScenarioInputs, type ScenarioOutputs } from '../lib/bottleneck.types'

export type ScenarioKey = 'current' | 'optimized'

export type BottleneckAction =
  | { type: 'updateAverageDealMargin'; scenario: ScenarioKey; value: number }
  | { type: 'updateTotalLeads'; scenario: ScenarioKey; value: number }
  | { type: 'updateRate'; scenario: ScenarioKey; stage: ConversionStage; value: number }
  | { type: 'reset' }

const stageLabels: Record<ConversionStage, string> = {
  leadQualification: 'Lead Qualification',
  opportunityToAppointment: 'Opportunity to Appointment',
  opportunityToContract: 'Opportunity to Contract',
  contractToAssignment: 'Contract to Assignment',
  assignmentToClosing: 'Assignment to Closing',
}

export function ScenarioPanel({
  scenarioKey,
  title,
  inputs,
  outputs,
  comparedInputs,
  editable,
  dispatch,
}: {
  scenarioKey: ScenarioKey
  title: string
  inputs: ScenarioInputs
  outputs: ScenarioOutputs
  comparedInputs?: ScenarioInputs
  editable: boolean
  dispatch: (action: BottleneckAction) => void
}) {
  return (
    <section data-testid={`scenario-${scenarioKey}`} className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-black tracking-tight">{title}</h3>
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Left Main</div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField
          label="Avg Margin"
          ariaLabel={`${title} average deal margin`}
          value={inputs.averageDealMargin}
          step={1000}
          editable={editable}
          onCommit={(value) =>
            dispatch({
                type: 'updateAverageDealMargin',
                scenario: scenarioKey,
                value,
              })
          }
        />
        <NumberField
          label="Total Leads"
          ariaLabel={`${title} total leads`}
          value={inputs.totalLeads}
          step={1}
          editable={editable}
          onCommit={(value) =>
            dispatch({
                type: 'updateTotalLeads',
                scenario: scenarioKey,
                value,
              })
          }
        />
      </div>

      <div className="rounded-md bg-white p-3 text-slate-950">
        {CONVERSION_STAGES.map((stage) => (
          <ConversionRow
            key={stage}
            label={stageLabels[stage]}
            rate={inputs.rates[stage]}
            count={outputs.stageCounts[stage]}
            comparedRate={comparedInputs?.rates[stage]}
            editable={editable}
            onChange={(value) =>
              dispatch({
                type: 'updateRate',
                scenario: scenarioKey,
                stage,
                value,
              })
            }
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Gross Revenue</span>
        <span className="text-xl font-black tabular-nums">{formatDollars(outputs.grossRevenue)}</span>
      </div>
    </section>
  )
}

function NumberField({
  label,
  ariaLabel,
  value,
  step,
  editable,
  onCommit,
}: {
  label: string
  ariaLabel: string
  value: number
  step: number
  editable: boolean
  onCommit: (value: number) => void
}) {
  const [displayValue, setDisplayValue] = useState(String(value))

  useEffect(() => {
    setDisplayValue(String(value))
  }, [value])

  function commitValue() {
    onCommit(Number(displayValue))
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        aria-label={ariaLabel}
        type="number"
        min={0}
        step={step}
        readOnly={!editable}
        value={displayValue}
        onChange={(event) => setDisplayValue(event.target.value)}
        onBlur={commitValue}
        className="h-10 w-full rounded-md border border-slate-800 bg-slate-900 px-3 text-sm font-black tabular-nums text-white outline-none focus:border-[#ff4d56]"
      />
    </label>
  )
}

function formatDollars(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'USD',
  }).format(value)
}
