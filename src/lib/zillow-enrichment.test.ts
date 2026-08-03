import { describe, expect, it } from 'vitest'
import { findZillowHomeInfo, parseZillowHtml } from './zillow-enrichment'

describe('Zillow enrichment parsing', () => {
  it('finds Zillow home info even when the page nesting changes', () => {
    const homeInfo = { zpid: 123, yearBuilt: 1924, zestimate: 158400 }
    expect(findZillowHomeInfo({ props: { pageProps: { componentProps: { homeInfo } } } })).toEqual(homeInfo)
  })

  it('extracts property facts from __NEXT_DATA__ without a browser binary', () => {
    const html = `
      <html><body><script id="__NEXT_DATA__" type="application/json">
        ${JSON.stringify({
          props: {
            pageProps: {
              homeInfo: {
                zpid: 123,
                yearBuilt: 1924,
                zestimate: 158400,
                rentZestimate: 1450,
                taxAssessedValue: 157500,
                lotAreaValue: 9040,
                lotAreaUnit: 'sqft',
                dateSold: 1622764800000,
                lastSoldPrice: 97250,
              },
            },
          },
        })}
      </script></body></html>
    `

    expect(parseZillowHtml(html)).toMatchObject({
      success: true,
      zestimate: 158400,
      rentZestimate: 1450,
      taxAssessment: 157500,
      yearBuilt: 1924,
      lotSizeSqft: 9040,
      lastSaleDate: '2021-06-04',
      lastSalePrice: 97250,
    })
  })

  it('reports an extraction failure instead of a false success', () => {
    expect(parseZillowHtml('<html><body>Captcha</body></html>')).toMatchObject({
      success: false,
      error: 'Could not extract Zillow property data',
    })
  })
})
