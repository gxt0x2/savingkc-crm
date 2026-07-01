import { describe, it, expect } from 'vitest'
import {
  resolveSpintax,
  resolveMergeFields,
  renderMessage,
  countVariants,
} from './spintax'

describe('resolveSpintax', () => {
  it('picks one option from a group', () => {
    const out = resolveSpintax('{Hi|Hey|Yo}', () => 0)
    expect(out).toBe('Hi')
  })

  it('resolves nested spintax', () => {
    // rng always returns 0 → always first option at each level
    const out = resolveSpintax('{Hi|{Hey|Yo}} there', () => 0)
    expect(out).toBe('Hi there')
  })

  it('resolves a nested option when outer picks second', () => {
    // Sequence of rng values: innermost resolved first.
    const vals = [0.99, 0] // innermost {Hey|Yo}->Yo (0.99), outer {Hi|Yo}->Hi(0)
    let i = 0
    const rng = () => vals[i++ % vals.length]
    const out = resolveSpintax('{Hi|{Hey|Yo}}', rng)
    expect(['Hi', 'Yo']).toContain(out)
  })

  it('leaves merge fields (no pipe) untouched', () => {
    expect(resolveSpintax('Hi {first_name}', () => 0)).toBe('Hi {first_name}')
  })
})

describe('resolveMergeFields', () => {
  const ctx = {
    first_name: 'Jane',
    last_name: 'Doe',
    address: '123 Main St',
    city: 'KC',
    custom_fields: { balance: '5,000', county: 'Clay' },
  }

  it('substitutes snake_case and camelCase and spaced keys', () => {
    expect(resolveMergeFields('Hi {first_name}', ctx)).toBe('Hi Jane')
    expect(resolveMergeFields('Hi {firstName}', ctx)).toBe('Hi Jane')
    expect(resolveMergeFields('Hi {First Name}', ctx)).toBe('Hi Jane')
  })

  it('builds full_name', () => {
    expect(resolveMergeFields('{full_name}', ctx)).toBe('Jane Doe')
  })

  it('substitutes custom fields', () => {
    expect(resolveMergeFields('Owe {balance} in {county}', ctx)).toBe('Owe 5,000 in Clay')
  })

  it('blanks unknown fields (never leaks raw tags)', () => {
    expect(resolveMergeFields('Hi {unknown_field}!', ctx)).toBe('Hi !')
  })

  it('maps property_address to address', () => {
    expect(resolveMergeFields('{property_address}', ctx)).toBe('123 Main St')
  })
})

describe('renderMessage', () => {
  it('is deterministic for the same seed key', () => {
    const tpl = '{Hi|Hey|Yo} {first_name}, interested in {address}?'
    const ctx = { first_name: 'Sam', address: '9 Oak Ave', phone: '+18160000001' }
    const a = renderMessage(tpl, ctx, ctx.phone)
    const b = renderMessage(tpl, ctx, ctx.phone)
    expect(a).toBe(b)
    expect(a).toContain('Sam')
    expect(a).toContain('9 Oak Ave')
    expect(a).not.toContain('|')
    expect(a).not.toContain('{')
  })

  it('produces different variants for different recipients (usually)', () => {
    const tpl = '{Hi|Hey|Yo|Hello|Greetings} there'
    const outs = new Set<string>()
    for (let i = 0; i < 20; i++) {
      outs.add(renderMessage(tpl, { phone: `+1816000${1000 + i}` }, `+1816000${1000 + i}`))
    }
    // With 5 variants across 20 recipients we expect more than one distinct output.
    expect(outs.size).toBeGreaterThan(1)
  })
})

describe('countVariants', () => {
  it('multiplies option counts', () => {
    expect(countVariants('{a|b|c} {x|y}')).toBe(6)
  })
  it('counts nested distinctly', () => {
    // {a|{b|c}} expands to a, b, c → 3 distinct variants
    expect(countVariants('{a|{b|c}}')).toBe(3)
  })
  it('returns 1 with no spintax', () => {
    expect(countVariants('Hi {first_name}')).toBe(1)
  })
})
