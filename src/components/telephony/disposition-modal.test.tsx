import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DispositionModal } from './disposition-modal'

function renderModal(props: Partial<React.ComponentProps<typeof DispositionModal>> = {}) {
  return renderToStaticMarkup(
    <DispositionModal
      open
      onClose={() => {}}
      onDisposition={() => true}
      leadName="Jill Woods"
      phoneNumber="+18169169564"
      {...props}
    />,
  )
}

describe('DispositionModal', () => {
  it('defaults normal dialer calls to the canonical outcome grid', () => {
    const html = renderModal()

    expect(html).toContain('grid grid-cols-2 xl:grid-cols-3')
    expect(html).toContain('Reached Heir')
    expect(html).toContain('No Answer')
    expect(html).toContain('Left Voicemail')
    expect(html).toContain('Dead Lead')
    expect(html).toContain('Save &amp; Next Lead')
  })

  it('keeps heir queue controls scoped to heir queue dispositions', () => {
    const html = renderModal({
      variant: 'heirQueue',
      markAsLeadAvailable: true,
      markAsLeadLabel: 'Mark Angela Taylor as lead',
      showVerifyToggle: true,
      verifyLabel: 'Verified — this is Angela Taylor',
      primaryActionLabel: 'Save & Next Number',
    })

    expect(html).toContain('grid grid-cols-2 xl:grid-cols-3')
    expect(html).toContain('Mark Angela Taylor as lead')
    expect(html).toContain('Verified — this is Angela Taylor')
    expect(html).toContain('Save &amp; Next Number')
  })

  it('surfaces a required dead reason when the dead outcome is preselected', () => {
    const html = renderModal({
      selectedDisposition: 'dead',
    })

    expect(html).toContain('Why is it dead?')
    expect(html).toContain('No living heirs found')
  })
})
