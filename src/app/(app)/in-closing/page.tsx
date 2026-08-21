import { redirect } from 'next/navigation'

export default function InClosingPage() {
  redirect('/contacts?list=in_closing')
}
