import type { Metadata } from 'next'
import '../ppc/sell.css'
import { SellLanding } from '../ppc/SellLanding'
import { GoogleTagManager } from '../ppc/GoogleTagManager'
import { OpenAIAdsPixel } from '../ppc/OpenAIAdsPixel'
import { PPC_CAMPAIGNS } from '@/lib/ppc/campaigns'

const EXCESS_PROCEEDS_CAMPAIGN = PPC_CAMPAIGNS.find((campaign) => campaign.key === 'excess_proceeds')!
const PPC_PHONE_DISPLAY = process.env.NEXT_PUBLIC_PPC_EXCESS_PROCEEDS_PHONE ?? EXCESS_PROCEEDS_CAMPAIGN.phoneDisplay
const PPC_PHONE_TEL = (process.env.NEXT_PUBLIC_PPC_EXCESS_PROCEEDS_PHONE_TEL ?? EXCESS_PROCEEDS_CAMPAIGN.phoneTel).replace(/[^+\d]/g, '')
const SHOW_BOOKING_CTA = false

export const metadata: Metadata = {
  title: 'Kansas City Excess Proceeds Help — Saving KC Homebuyers',
  description:
    'Think the county is holding surplus money after a tax sale? Check the address, understand the claim path, and get help before deadlines disappear.',
  other: {
    'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  },
}

export default function ExcessProceedsPpcPage() {
  return (
    <>
      <GoogleTagManager />
      <OpenAIAdsPixel />
      <SellLanding
        phoneDisplay={PPC_PHONE_DISPLAY}
        phoneTel={PPC_PHONE_TEL}
        showBookingCta={SHOW_BOOKING_CTA}
        variant="excess-proceeds"
      />
    </>
  )
}
