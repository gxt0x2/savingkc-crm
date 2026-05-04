import { redirect } from 'next/navigation'

export default function BuyersRedirect() {
  redirect('/dispo/contacts?tab=buyers')
}
