import { ConditionalWorkspaceFrame } from '@/components/conversations/conditional-workspace-frame'

export default function SettingsWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <ConditionalWorkspaceFrame>{children}</ConditionalWorkspaceFrame>
}
