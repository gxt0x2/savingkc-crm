// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'casey@savingkc.com' }, loading: false }),
}))

import { NewTaskModal } from './new-task-modal'

describe('NewTaskModal call follow-up', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('opens with a real title and persists a canonical primary next action', async () => {
    const onCreated = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      taskId: 'work-item-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(
      <NewTaskModal
        leadId="lead-1"
        leadName="Michelle Said"
        initialTitle="Follow up with Michelle Said"
        primaryNextAction
        onClose={() => {}}
        onCreated={onCreated}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Set next action' })).toBeVisible()
    expect(screen.getByLabelText('Title')).toHaveValue('Follow up with Michelle Said')
    const save = screen.getByRole('button', { name: 'Save Next Action' })
    expect(save).toBeEnabled()

    fireEvent.click(save)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, request] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      title: 'Follow up with Michelle Said',
      leadId: 'lead-1',
      assignedTo: 'Casey',
      primaryNextAction: true,
    })
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })
})
