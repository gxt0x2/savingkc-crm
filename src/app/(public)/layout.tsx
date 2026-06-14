// Public route group — no auth, no CRM chrome. Used by Google Ads landing
// pages and other marketing surfaces. The root layout sets the CRM dark
// theme on <html>/<body>; we override here with a light wrapper so the LP
// renders pixel-equivalent to the design source.
//
// Material Symbols is already preloaded by the root layout, so we don't
// double-load it here.
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
