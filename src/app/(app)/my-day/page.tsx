import { notFound, redirect } from 'next/navigation'

import { MyDayWorkspace } from '@/components/my-day/my-day-workspace'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { canAccessCaseyMyDay, loadCaseyMyDay } from '@/lib/my-day-server'

export default async function MyDayPage() {
  const email = await getCurrentUserEmail()
  if (!email) redirect('/login?redirect=/my-day')
  if (!await canAccessCaseyMyDay(email)) notFound()

  const data = await loadCaseyMyDay()
  return <MyDayWorkspace initialData={data} />
}
