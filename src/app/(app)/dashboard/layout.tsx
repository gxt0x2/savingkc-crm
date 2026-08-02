import { WorkspaceFrame } from '@/components/conversations/workspace-frame'

export default function ReportsWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceFrame hideHeader>{children}</WorkspaceFrame>
}
