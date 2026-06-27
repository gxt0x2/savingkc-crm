export function paidClickCount(platformClicks: number, firstPartyClickIds: number): number {
  return platformClicks > 0 ? platformClicks : firstPartyClickIds
}
