import { describe, expect, it } from 'vitest'
import { parseRedfinAutocomplete, parseRedfinHtml } from './redfin-enrichment'

describe('Redfin enrichment parsing', () => {
  it('resolves the property URL from Redfin autocomplete JSON', () => {
    const body = '{}&&' + JSON.stringify({
      payload: {
        sections: [{ rows: [{ url: '/MO/Smithville/305-S-Mill-St-64089/home/123456' }] }],
      },
    })

    expect(parseRedfinAutocomplete(body)).toBe(
      'https://www.redfin.com/MO/Smithville/305-S-Mill-St-64089/home/123456',
    )
  })

  it('extracts valuation fields from embedded property state', () => {
    const html = `
      <html><body><script>
        {"redfinEstimate":{"estimate":158400},"yearBuilt":1924,
         "lastSoldPrice":97250,"lastSoldDate":"2021-06-04"}
      </script></body></html>
    `

    expect(parseRedfinHtml(html, 'https://www.redfin.com/home/1')).toMatchObject({
      success: true,
      redfinEstimate: 158400,
      yearBuilt: 1924,
      lastSalePrice: 97250,
      lastSaleDate: '2021-06-04',
    })
  })

  it('reports an extraction failure instead of a false success', () => {
    expect(parseRedfinHtml('<html><body>Property unavailable</body></html>')).toMatchObject({
      success: false,
      error: 'Could not extract Redfin estimate',
    })
  })
})
