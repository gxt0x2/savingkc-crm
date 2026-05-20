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
  it('defaults normal dialer calls to the regular rectangular outcome grid', () => {
    const html = renderModal()

    expect(html).toContain('grid grid-cols-2 xl:grid-cols-3')
    expect(html).toContain('Contact')
    expect(html).toContain('Not Contacted')
    expect(html).toContain('Left Voicemail')
    expect(html).toContain('Save &amp; Next Lead')
  })

  it('keeps heir queue controls scoped to heir queue dispositions', () => {
    const html = renderModal({
      variant: 'heirQueue',
      markAsLeadAvailable: true,
      markAsLeadLabel: 'Mark Angela Taylor as lead',
      primaryActionLabel: 'Save & Next Number',
    })

    expect(html).toContain('grid grid-cols-2 xl:grid-cols-3')
    expect(html).toContain('Mark Angela Taylor as lead')
    expect(html).toContain('Save &amp; Next Number')
  })
})
