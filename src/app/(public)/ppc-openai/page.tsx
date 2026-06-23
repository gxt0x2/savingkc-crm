import type { Metadata } from 'next'
import '../ppc/sell.css'
import { SellLanding } from '../ppc/SellLanding'
import { GoogleTagManager } from '../ppc/GoogleTagManager'
import { OpenAIAdsPixel } from '../ppc/OpenAIAdsPixel'
import { DEFAULT_PPC_CAMPAIGN } from '@/lib/ppc/campaigns'

const PPC_PHONE_DISPLAY = process.env.NEXT_PUBLIC_PPC_PHONE ?? DEFAULT_PPC_CAMPAIGN.phoneDisplay
const PPC_PHONE_TEL = (process.env.NEXT_PUBLIC_PPC_PHONE_TEL ?? DEFAULT_PPC_CAMPAIGN.phoneTel).replace(/[^+\d]/g, '')
const SHOW_BOOKING_CTA = false

export const metadata: Metadata = {
  title: 'Sell Your KC House Fast — Saving KC Homebuyers',
  description:
    'Get a private Kansas City cash-offer range based on your property situation, timeline, and condition. No fees, repairs, or cleanup.',
  other: {
    'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  },
}

export default function OpenAIAdsPpcPage() {
  return (
    <>
      <GoogleTagManager />
      <OpenAIAdsPixel />
      <SellLanding phoneDisplay={PPC_PHONE_DISPLAY} phoneTel={PPC_PHONE_TEL} showBookingCta={SHOW_BOOKING_CTA} />
    </>
  )
}
