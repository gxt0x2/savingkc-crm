import type { Metadata } from 'next'
import '@fontsource-variable/inter'
import './globals.css'
import { Providers } from '@/lib/providers'

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
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout owns this global icon font. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="ck-dark bg-background text-on-surface antialiased min-h-screen font-sans">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
