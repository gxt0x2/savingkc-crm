import { redirect } from 'next/navigation'

export default function PipelinePage() {
  redirect('/contacts?list=contacted')
}
