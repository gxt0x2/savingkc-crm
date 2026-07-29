import { ConditionalWorkspaceFrame } from '@/components/conversations/conditional-workspace-frame'

export default function CalendarWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <ConditionalWorkspaceFrame>{children}</ConditionalWorkspaceFrame>
}
