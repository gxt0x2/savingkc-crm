// Public route group — no auth, no CRM chrome. Used by Google Ads landing
// pages and other marketing surfaces. The root layout sets the CRM dark
// theme on <html>/<body>; we override here with a light wrapper so the LP
// renders pixel-equivalent to the design source.
//
// Material Symbols is already preloaded by the root layout, so we don't
// double-load it here.
import Script from 'next/script'

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID ?? 'GTM-MM68JH2'

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="skc-public-canvas" style={{ background: '#ffffff', color: '#0a0a0b', minHeight: '100vh' }}>
      <Script id="gtm-public" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
          (function(w,d,s,l,i){
            var f=d.getElementsByTagName(s)[0], j=d.createElement(s), dl=l!='dataLayer'?'&l='+l:'';
            j.async=true;
            j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
            f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','${GTM_ID}');
        `}
      </Script>
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
        />
      </noscript>
      {children}
    </div>
  )
}
