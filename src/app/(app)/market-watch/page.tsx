import { MarketWatchView } from '@/components/market-watch/market-watch-view'
import { loadWholesaleMarketCatalog } from '@/lib/market-watch/catalog'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Wholesale Market Watch',
}

export default async function MarketWatchPage() {
  const snapshots = await loadWholesaleMarketCatalog()
  return <MarketWatchView snapshots={snapshots} />
}
