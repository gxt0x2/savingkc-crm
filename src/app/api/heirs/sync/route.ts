import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  assertDialerMutationControl,
  dialerMutationControlErrorResponse,
} from '@/lib/api/dialer-mutation-control'
import { parseHeirSyncRows } from '@/lib/server/heir-sync-payload'
import {
  dialerProviderDeadlineExceeded,
  dialerProviderSignal,
} from '@/lib/server/dialer-provider-boundary'
import { supabase } from '@/lib/supabase-lazy'

const DIALER_OPERATION_UNCERTAIN_HEADERS = {
  'X-Dialer-Operation-Uncertain': 'true',
}

// POST /api/heirs/sync
// body: { lead_id }
//
// Triggers a skip-trace run against the deceased owner linked to this lead and
// upserts the returned relatives into prospect_phones. Fronted behind the
// SKIPTRACE_SERVICE_URL env var so Jackson/Johnson/other counties can point at
// whatever deployment is live without another code change.
//
// Shape of expected service response:
//   { relatives: [{ name, relationship, phones: [{ number, type, is_connected }] }] }
export async function POST(req: Request) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { lead_id, dialerSessionId } = await req.json()
    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
    }

    const { data: prospect, error: pErr } = await supabase
      .from('prospects')
      .select('id, owner_1, owner_1_first, owner_1_last, situs_street, situs_city, situs_state, situs_zip, county, is_deceased')
      .eq('lead_id', lead_id)
      .limit(1)
      .single()

    if (pErr || !prospect) {
      return NextResponse.json(
        { error: 'No prospect linked to this lead' },
        { status: 404 },
      )
    }

    if (!prospect.is_deceased) {
      return NextResponse.json(
        { error: 'Skip-trace heir flow is only for deceased owners' },
        { status: 400 },
      )
    }

    let controlledSession = null
    try {
      controlledSession = await assertDialerMutationControl({
        request: req,
        actor,
        sessionId: dialerSessionId,
        subject: { leadId: lead_id, prospectId: prospect.id },
        protectMatchingOpenSession: true,
      })
    } catch (error) {
      const controlResponse = dialerMutationControlErrorResponse(error)
      if (controlResponse) return controlResponse
      throw error
    }

    const serviceUrl = process.env.SKIPTRACE_SERVICE_URL
    if (!serviceUrl) {
      return NextResponse.json(
        {
          error: 'Skip-trace service not configured',
          hint: 'Set SKIPTRACE_SERVICE_URL in env to the FastAPI endpoint (see /Users/ernestdodson/skip-trace).',
        },
        { status: 503 },
      )
    }

    const providerSignal = dialerProviderSignal(req, controlledSession)
    let upstream: Response
    try {
      upstream = await fetch(`${serviceUrl}/skip-trace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: prospect.owner_1_first,
          last_name: prospect.owner_1_last,
          address: prospect.situs_street,
          city: prospect.situs_city,
          state: prospect.situs_state,
          zip_code: prospect.situs_zip,
        }),
        ...(providerSignal ? { signal: providerSignal } : {}),
      })
    } catch (error) {
      if (providerSignal?.aborted) {
        return NextResponse.json({
          error: dialerProviderDeadlineExceeded(providerSignal)
            ? 'Skip-trace service timed out'
            : 'Skip-trace request was cancelled',
        }, {
          status: dialerProviderDeadlineExceeded(providerSignal) ? 504 : 499,
          headers: DIALER_OPERATION_UNCERTAIN_HEADERS,
        })
      }
      throw error
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return NextResponse.json(
        { error: `Skip-trace service error (${upstream.status})`, detail: text.slice(0, 500) },
        { status: 502 },
      )
    }

    let rows: ReturnType<typeof parseHeirSyncRows>
    try {
      rows = parseHeirSyncRows(await upstream.json())
    } catch (error) {
      if (providerSignal?.aborted) {
        return NextResponse.json({
          error: dialerProviderDeadlineExceeded(providerSignal)
            ? 'Skip-trace service timed out'
            : 'Skip-trace request was cancelled',
        }, {
          status: dialerProviderDeadlineExceeded(providerSignal) ? 504 : 499,
          headers: DIALER_OPERATION_UNCERTAIN_HEADERS,
        })
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Skip trace returned an invalid response' },
        { status: 502 },
      )
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Skip trace returned no usable phone records; existing heirs were preserved.' },
        { status: 422 },
      )
    }

    if (controlledSession) {
      try {
        await assertDialerMutationControl({
          request: req,
          actor,
          sessionId: controlledSession.id,
          subject: { leadId: lead_id, prospectId: prospect.id },
          required: true,
        })
      } catch (error) {
        const controlResponse = dialerMutationControlErrorResponse(error)
        if (controlResponse) return controlResponse
        throw error
      }
    }

    const { data: syncedCount, error: syncError } = await supabase.rpc(
      'replace_heir_skip_trace_v1',
      {
        p_lead_id: lead_id,
        p_prospect_id: prospect.id,
        p_actor: actor.name,
        p_rows: rows,
      },
    )

    if (syncError) {
      console.error('[heirs/sync] atomic replacement failed', syncError)
      return NextResponse.json({ error: 'Could not save the skip-trace results' }, { status: 500 })
    }

    if (Number(syncedCount) !== rows.length) {
      console.error('[heirs/sync] atomic replacement count mismatch', {
        expected: rows.length,
        actual: syncedCount,
      })
      return NextResponse.json({ error: 'Skip-trace results could not be verified' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      relatives_synced: rows.length,
    })
  } catch (err) {
    console.error('[heirs/sync] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
