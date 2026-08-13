import { notFound, redirect } from 'next/navigation'

import { MyDayWorkspace } from '@/components/my-day/my-day-workspace'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { loadCaseyMyDay } from '@/lib/my-day-server'
import { isCaseyCrmUser } from '@/lib/telephony/agent-identity'

export default async function MyDayPage() {
  const email = await getCurrentUserEmail()
  if (!email) redirect('/login?redirect=/my-day')
  if (!isCaseyCrmUser(email)) notFound()

  const data = await loadCaseyMyDay()
  return <MyDayWorkspace initialData={data} />
}
