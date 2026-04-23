import { redirect } from 'next/navigation'

export default function VendorsRedirect() {
  redirect('/dispo/buyers?tab=vendors')
}
