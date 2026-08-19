// Public route group — no auth, no CRM chrome. Used by Google Ads landing
// pages and other marketing surfaces. The root layout sets the CRM dark
// theme on <html>/<body>; we override here with a light wrapper so the LP
// renders pixel-equivalent to the design source.
//
// Shared icons use the small local subset declared in globals.css, so public
// routes never make a render-blocking request to Google Fonts.
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="skc-public-canvas" style={{ background: '#ffffff', color: '#0a0a0b', minHeight: '100vh' }}>
      {children}
    </div>
  )
}
