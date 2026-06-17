import type { Metadata } from 'next'
import '../ppc/sell.css'
import { SellLanding } from '../ppc/SellLanding'
import { GoogleTagManager } from '../ppc/GoogleTagManager'
import { OpenAIAdsPixel } from '../ppc/OpenAIAdsPixel'
import { PPC_CAMPAIGNS } from '@/lib/ppc/campaigns'

const REDEMPTION_CAMPAIGN = PPC_CAMPAIGNS.find((campaign) => campaign.key === 'redemption')!
const PPC_PHONE_DISPLAY = process.env.NEXT_PUBLIC_PPC_REDEMPTION_PHONE ?? REDEMPTION_CAMPAIGN.phoneDisplay
const PPC_PHONE_TEL = (process.env.NEXT_PUBLIC_PPC_REDEMPTION_PHONE_TEL ?? REDEMPTION_CAMPAIGN.phoneTel).replace(/[^+\d]/g, '')
const SHOW_BOOKING_CTA = false

export const metadata: Metadata = {
  title: 'Kansas City Tax Sale Redemption Help — Saving KC Homebuyers',
  description:
    'Trying to redeem a KC property after tax sale? Get a private review, deadline help, and a cash offer option before the redemption window closes.',
  other: {
    'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  },
}

export default function RedemptionPpcPage() {
  return (
    <>
      <GoogleTagManager />
      <OpenAIAdsPixel />
      <SellLanding
        phoneDisplay={PPC_PHONE_DISPLAY}
        phoneTel={PPC_PHONE_TEL}
        showBookingCta={SHOW_BOOKING_CTA}
        variant="redemption"
      />
    </>
  )
}
