import type { Metadata } from 'next'
import ForceLight from './force-light'

export const metadata: Metadata = {
  title: 'Deal Page | Saving KC Homebuyers',
  description: 'Investment opportunity from Saving KC Homebuyers',
}

export default function DealsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ForceLight />
      {children}
    </>
  )
}
