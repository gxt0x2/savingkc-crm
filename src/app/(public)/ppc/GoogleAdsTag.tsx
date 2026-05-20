import Script from 'next/script'

/**
 * Google Ads conversion tracking bootstrap. Loads gtag.js with the account ID
 * from NEXT_PUBLIC_GOOGLE_ADS_ID. Without that env var set, this renders
 * nothing — useful for previews and during initial development.
 */
export function GoogleAdsTag() {
  const id = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
  if (!id) return null
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
        strategy="afterInteractive"
      />
      <Script id="gads-bootstrap" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${id}');
        `}
      </Script>
    </>
  )
}
