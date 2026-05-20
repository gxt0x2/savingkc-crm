import type { Metadata } from 'next'
import './sell.css'
import { SellLanding } from './SellLanding'
import { GoogleTagManager } from './GoogleTagManager'
import { EditOverlay } from './EditOverlay'

const PPC_PHONE_DISPLAY = process.env.NEXT_PUBLIC_PPC_PHONE ?? '(816) 608-8808'
const PPC_PHONE_TEL = (process.env.NEXT_PUBLIC_PPC_PHONE_TEL ?? '+18166088808').replace(/[^+\d]/g, '')

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
      <SellLanding phoneDisplay={PPC_PHONE_DISPLAY} phoneTel={PPC_PHONE_TEL} />
      <EditOverlay />
    </>
  )
}
