import { Icon } from '@/components/ui/icon'

export type TaskChannel = 'call' | 'sms' | 'email' | 'voicemail' | 'mail' | 'task'

export function getChannelIcon(channel: TaskChannel | string): string {
  switch (channel) {
    case 'call':
      return 'call'
    case 'sms':
      return 'sms'
    case 'email':
      return 'email'
    case 'voicemail':
      return 'voicemail'
    case 'mail':
      return 'mail'
    default:
      return 'task_alt'
  }
}

export function getChannelColor(channel: TaskChannel | string): string {
  switch (channel) {
    case 'call':
      return 'text-blue-600'
    case 'sms':
      return 'text-green-600'
    case 'email':
      return 'text-purple-600'
    case 'voicemail':
      return 'text-orange-600'
    case 'mail':
      return 'text-red-600'
    default:
      return 'text-slate-600'
  }
}

export function getChannelBgColor(channel: TaskChannel | string): string {
  switch (channel) {
    case 'call':
      return 'bg-blue-100'
    case 'sms':
      return 'bg-green-100'
    case 'email':
      return 'bg-purple-100'
    case 'voicemail':
      return 'bg-orange-100'
    case 'mail':
      return 'bg-red-100'
    default:
      return 'bg-slate-100'
  }
}

interface ChannelBadgeProps {
  channel: TaskChannel | string
  size?: 'sm' | 'md' | 'lg'
}

export function ChannelBadge({ channel, size = 'md' }: ChannelBadgeProps) {
  const sizeClasses = {
    sm: 'w-5 h-5 text-xs',
    md: 'w-6 h-6 text-sm',
    lg: 'w-8 h-8 text-base',
  }

  return (
    <div
      className={`${sizeClasses[size]} ${getChannelBgColor(channel)} rounded-full flex items-center justify-center shrink-0`}
      title={`${channel} task`}
    >
      <Icon name={getChannelIcon(channel)} className={`!text-xs ${getChannelColor(channel)}`} />
    </div>
  )
}

export function getChannelLabel(channel: TaskChannel | string): string {
  switch (channel) {
    case 'call':
      return 'Call'
    case 'sms':
      return 'SMS'
    case 'email':
      return 'Email'
    case 'voicemail':
      return 'Voicemail'
    case 'mail':
      return 'Mail'
    default:
      return 'Task'
  }
}
