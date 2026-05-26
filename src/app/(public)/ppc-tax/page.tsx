import type { Metadata } from 'next'
import '../ppc/sell.css'
import { GoogleTagManager } from '../ppc/GoogleTagManager'
import { EditOverlay } from '../ppc/EditOverlay'
import { SellLanding } from '../ppc/SellLanding'

const PPC_PHONE_DISPLAY = process.env.NEXT_PUBLIC_PPC_PHONE ?? '(816) 608-8808'
const PPC_PHONE_TEL = (process.env.NEXT_PUBLIC_PPC_PHONE_TEL ?? '+18166088808').replace(/[^+\d]/g, '')
const SHOW_BOOKING_CTA = false

export const metadata: Metadata = {
  title: 'Behind on Property Taxes and Want to Sell? — Saving KC Homebuyers',
  description:
    'Behind on property taxes in Kansas City? Get a fast cash offer, sell as-is, and clear tax problems at closing. Form today. Offer today.',
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
      <EditOverlay />
    </>
  )
}
