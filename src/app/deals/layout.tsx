import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Deal Page | Saving KC Homebuyers',
  description: 'Investment opportunity from Saving KC Homebuyers',
}

export default function DealsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white text-gray-900 min-h-screen" style={{ colorScheme: 'light' }}>
      {children}
    </div>
  )
}
