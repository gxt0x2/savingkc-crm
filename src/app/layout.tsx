import type { Metadata } from 'next'
import '@fontsource-variable/inter'
import './globals.css'
import './daily-rhythm.css'
import './mobile-crm.css'

export const metadata: Metadata = {
  title: 'Savings KC | Acquisitions CRM',
  description: 'SavingKC Real Estate Acquisitions CRM',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico', sizes: '16x16' },
    ],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="ck-dark bg-background text-on-surface antialiased min-h-screen font-sans">
        {children}
      </body>
    </html>
  )
}
