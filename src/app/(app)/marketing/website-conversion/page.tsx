import { Suspense } from 'react'

import { WebsiteConversionPage } from '@/components/marketing/website-conversion-page'

export default function MarketingWebsiteConversionPage() {
  return (
    <Suspense fallback={null}>
      <WebsiteConversionPage />
    </Suspense>
  )
}
