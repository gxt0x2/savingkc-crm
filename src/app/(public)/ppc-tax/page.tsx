import type { Metadata } from 'next'
import '../ppc/sell.css'
import { SellLanding } from '../ppc/SellLanding'
import { GoogleTagManager } from '../ppc/GoogleTagManager'
import { OpenAIAdsPixel } from '../ppc/OpenAIAdsPixel'
import { PPC_CAMPAIGNS } from '@/lib/ppc/campaigns'

const PROPERTY_TAX_CAMPAIGN = PPC_CAMPAIGNS.find((campaign) => campaign.key === 'property_tax')!
const PPC_PHONE_DISPLAY = process.env.NEXT_PUBLIC_PPC_TAX_PHONE ?? PROPERTY_TAX_CAMPAIGN.phoneDisplay
const PPC_PHONE_TEL = (process.env.NEXT_PUBLIC_PPC_TAX_PHONE_TEL ?? PROPERTY_TAX_CAMPAIGN.phoneTel).replace(/[^+\d]/g, '')
const SHOW_BOOKING_CTA = false

export const metadata: Metadata = {
  title: 'Behind on Property Taxes in Kansas City? Sell Privately — Saving KC Homebuyers',
  description:
    'Behind on KC property taxes? Sell as-is, pay $0 before closing, and have back taxes handled at closing. Get a private cash offer in 60 minutes.',
  other: {
    'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  },
}

export default function TaxPpcPage() {
  return (
    <>
      <GoogleTagManager />
      <OpenAIAdsPixel />
      <SellLanding
        phoneDisplay={PPC_PHONE_DISPLAY}
        phoneTel={PPC_PHONE_TEL}
        showBookingCta={SHOW_BOOKING_CTA}
        variant="tax"
      />
    </>
  )
}
