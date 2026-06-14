import type { Metadata } from 'next'
import './sell.css'
import { SellLanding } from './SellLanding'
import { GoogleTagManager } from './GoogleTagManager'
import { OpenAIAdsPixel } from './OpenAIAdsPixel'
import { EditOverlay } from './EditOverlay'
import { DEFAULT_PPC_CAMPAIGN } from '@/lib/ppc/campaigns'

const PPC_PHONE_DISPLAY = process.env.NEXT_PUBLIC_PPC_PHONE ?? DEFAULT_PPC_CAMPAIGN.phoneDisplay
const PPC_PHONE_TEL = (process.env.NEXT_PUBLIC_PPC_PHONE_TEL ?? DEFAULT_PPC_CAMPAIGN.phoneTel).replace(/[^+\d]/g, '')
// Search 2026 objective: finish the step form. Keep booking hidden for now.
const SHOW_BOOKING_CTA = false

export const metadata: Metadata = {
  title: 'Sell Your Tax-Delinquent or Inherited KC House — Saving KC Homebuyers',
  description:
    'Behind on property taxes? Inherited a house in Kansas City? Get a custom cash offer in 24 hours. 100+ KC homeowners helped. No fees, no repairs.',
  // Static page, but conversion bidding rewards fresh signals — keep cacheable
  // headers but not too aggressive.
  other: {
    'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  },
}

export default function SellPage() {
  return (
    <>
      <GoogleTagManager />
      <OpenAIAdsPixel />
      <SellLanding phoneDisplay={PPC_PHONE_DISPLAY} phoneTel={PPC_PHONE_TEL} showBookingCta={SHOW_BOOKING_CTA} />
      <EditOverlay />
    </>
  )
}
