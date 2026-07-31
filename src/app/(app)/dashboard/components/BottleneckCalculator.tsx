'use client'

import { useReducer } from 'react'

import { LEFT_MAIN_FIXTURE } from '../__fixtures__/leftMain'
import { calculateScenario, compareScenarios } from '../lib/bottleneck'
import type { ScenarioInputs } from '../lib/bottleneck.types'
import { BottleneckDiagnostic } from './BottleneckDiagnostic'
import { RevenueDelta } from './RevenueDelta'
import { type BottleneckAction, ScenarioPanel } from './ScenarioPanel'

interface CalculatorState {
  current: ScenarioInputs
  optimized: ScenarioInputs
}

const initialState: CalculatorState = {
  current: cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
  optimized: cloneInputs(LEFT_MAIN_FIXTURE.optimized.inputs),
}

export function BottleneckCalculator() {
  const [state, dispatch] = useReducer(bottleneckReducer, initialState)
  const currentOutputs = calculateScenario(state.current)
  const optimizedOutputs = calculateScenario(state.optimized)
  const comparison = compareScenarios(state.current, state.optimized)

  return (
    <section data-testid="bottleneck-calculator" data-control-depth="2" className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--crm-success)]">Scenario Model</div>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-[var(--crm-ink)]">Left Main Bottleneck Calculator</h2>
        </div>
        <button
          type="button"
          aria-label="Reset Left Main scenario"
          onClick={() => dispatch({ type: 'reset' })}
          className="h-9 rounded-md border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 text-xs font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand-border)] hover:text-[var(--crm-brand)]"
        >
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_280px]">
        <ScenarioPanel
          scenarioKey="current"
          title="Current State"
          inputs={state.current}
          outputs={currentOutputs}
          editable
          dispatch={dispatch}
        />
        <ScenarioPanel
          scenarioKey="optimized"
          title="Optimized State"
          inputs={state.optimized}
          outputs={optimizedOutputs}
          comparedInputs={state.current}
          editable
          dispatch={dispatch}
        />
        <RevenueDelta comparison={comparison} />
      </div>

      <div className="mt-4">
        <BottleneckDiagnostic />
      </div>
    </section>
  )
}

function bottleneckReducer(state: CalculatorState, action: BottleneckAction): CalculatorState {
  if (action.type === 'reset') {
    return {
      current: cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
      optimized: cloneInputs(LEFT_MAIN_FIXTURE.optimized.inputs),
    }
  }

  const target = state[action.scenario]
  const nextTarget =
    action.type === 'updateRate'
      ? {
          ...target,
          rates: {
            ...target.rates,
            [action.stage]: action.value,
          },
        }
      : action.type === 'updateAverageDealMargin'
        ? {
            ...target,
            averageDealMargin: Math.max(0, action.value),
          }
        : {
            ...target,
            totalLeads: Math.max(0, Math.round(action.value)),
          }

  return {
    ...state,
    [action.scenario]: nextTarget,
  }
}

function cloneInputs(inputs: ScenarioInputs): ScenarioInputs {
  return {
    averageDealMargin: inputs.averageDealMargin,
    totalLeads: inputs.totalLeads,
    rates: { ...inputs.rates },
  }
}
