import type { Metadata } from 'next'
import '../ppc/sell.css'
import { SellLanding } from '../ppc/SellLanding'
import { GoogleTagManager } from '../ppc/GoogleTagManager'

const PPC_PHONE_DISPLAY = process.env.NEXT_PUBLIC_PPC_PHONE ?? '(816) 608-8808'
const PPC_PHONE_TEL = (process.env.NEXT_PUBLIC_PPC_PHONE_TEL ?? '+18166088808').replace(/[^+\d]/g, '')
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
      <SellLanding
        phoneDisplay={PPC_PHONE_DISPLAY}
        phoneTel={PPC_PHONE_TEL}
        showBookingCta={SHOW_BOOKING_CTA}
        variant="tax"
      />
    </>
  )
}
