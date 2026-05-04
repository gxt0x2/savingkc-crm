import { redirect } from 'next/navigation'

export default function VendorsRedirect() {
  redirect('/dispo/contacts?tab=vendors')
}
