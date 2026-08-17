import { notFound, redirect } from 'next/navigation'

import { MyDayWorkspace } from '@/components/my-day/my-day-workspace'
import { getCurrentUserEmail, isUserAdmin } from '@/lib/auth/admin'
import { isCallReviewer } from '@/lib/call-review-reviewers'
import { canAccessCaseyMyDay, loadCaseyMyDay } from '@/lib/my-day-server'

export default async function MyDayPage() {
  const email = await getCurrentUserEmail()
  if (!email) redirect('/login?redirect=/my-day')
  if (!await canAccessCaseyMyDay(email)) notFound()

  const [data, isAdmin] = await Promise.all([loadCaseyMyDay(), isUserAdmin(email)])
  return <MyDayWorkspace initialData={data} canReviewCalls={isCallReviewer(email) || isAdmin} />
}
