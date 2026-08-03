import { WorkspaceFrame } from '@/components/conversations/workspace-frame'

export default function AiLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>
}
