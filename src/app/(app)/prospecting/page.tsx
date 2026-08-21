import { ProspectingWorkspace } from '@/components/prospecting/prospecting-workspace'

export const dynamic = 'force-dynamic'

export default async function ProspectingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const params = await searchParams
  return <ProspectingWorkspace openCreate={params.new === '1'} />
}
