import { WorkspaceFrame } from '@/components/conversations/workspace-frame'

export default function AriLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>
}
