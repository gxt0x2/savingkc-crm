import { redirect } from 'next/navigation'

import { DailyRhythmWorkspace } from '@/components/checklist/daily-rhythm-workspace'
import { getCurrentUserEmail } from '@/lib/auth/admin'

export default async function ChecklistPage() {
  const email = await getCurrentUserEmail()
  if (!email) redirect('/login?redirect=/checklist')

  return <DailyRhythmWorkspace userEmail={email} />
}
