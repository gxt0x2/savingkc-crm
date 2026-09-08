import { handleWebDialerCallIntent } from '@/lib/server/web-dialer-call-intent-route'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: Request) {
  return handleWebDialerCallIntent(request, 'prospecting')
}
