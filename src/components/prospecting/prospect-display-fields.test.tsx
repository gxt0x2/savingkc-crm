/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProspectAddressFields, ProspectOwnerNameFields } from './prospect-display-fields'

describe('prospect display fields', () => {
  it('shows first, MI, last, and suffix as their own cells', () => {
    render(<ProspectOwnerNameFields owner={{
      first: 'Betty',
      mi: 'J',
      last: 'Moore',
      suffix: null,
      fullName: 'Betty J Moore',
    }} />)

    expect(screen.getByLabelText('Owner name cells')).toBeVisible()
    expect(screen.getByText('First')).toBeVisible()
    expect(screen.getByText('Betty')).toBeVisible()
    expect(screen.getByText('MI')).toBeVisible()
    expect(screen.getByText('J')).toBeVisible()
    expect(screen.getByText('Last')).toBeVisible()
    expect(screen.getByText('Moore')).toBeVisible()
    expect(screen.getByText('Suffix')).toBeVisible()
    expect(screen.getByText('—')).toBeVisible()
  })

  it('shows street and unit as their own cells next to city, MO, and zip', () => {
    render(<ProspectAddressFields
      label="Situs address cells"
      address={{
        street: '303 E Partridge St',
        unit: 'Unit 38',
        city: 'Kansas City',
        state: 'MO',
        zip: '64133',
      }}
    />)

    expect(screen.getByLabelText('Situs address cells')).toBeVisible()
    expect(screen.getByText('Street')).toBeVisible()
    expect(screen.getByText('303 E Partridge St')).toBeVisible()
    expect(screen.getByText('Unit')).toBeVisible()
    expect(screen.getByText('Unit 38')).toBeVisible()
    expect(screen.getByText((content) => content === 'MO')).toBeVisible()
  })
})
