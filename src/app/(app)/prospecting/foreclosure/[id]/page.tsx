import { ForeclosureDetail } from '@/components/prospecting/foreclosure-detail'

export const dynamic = 'force-dynamic'

export default async function ForeclosureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ForeclosureDetail id={id} />
}
