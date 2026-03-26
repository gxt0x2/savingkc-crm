'use client'

import { Icon } from '@/components/ui/icon'

interface ModuleHealth {
  name: string
  icon: string
  features_done: number
  features_total: number
  open_bugs: number
  last_error: string | null
  status: 'healthy' | 'warning' | 'critical'
}

/**
 * FBK-08: Module Health Cards
 * Per-section health status
 */
export function ModuleHealthCards() {
  // Hardcoded for now - could be made dynamic via API
  const modules: ModuleHealth[] = [
    {
      name: 'Leads',
      icon: 'person',
      features_done: 18,
      features_total: 20,
      open_bugs: 1,
      last_error: null,
      status: 'healthy',
    },
    {
      name: 'Pipeline',
      icon: 'timeline',
      features_done: 15,
      features_total: 18,
      open_bugs: 0,
      last_error: null,
      status: 'healthy',
    },
    {
      name: 'Conversations',
      icon: 'chat',
      features_done: 8,
      features_total: 12,
      open_bugs: 1,
      last_error: '2 hours ago',
      status: 'warning',
    },
    {
      name: 'Calendar',
      icon: 'calendar_today',
      features_done: 6,
      features_total: 8,
      open_bugs: 0,
      last_error: null,
      status: 'healthy',
    },
    {
      name: 'Dashboard',
      icon: 'dashboard',
      features_done: 12,
      features_total: 15,
      open_bugs: 0,
      last_error: null,
      status: 'healthy',
    },
    {
      name: 'Ari',
      icon: 'auto_fix_high',
      features_done: 22,
      features_total: 25,
      open_bugs: 1,
      last_error: null,
      status: 'healthy',
    },
    {
      name: 'Settings',
      icon: 'settings',
      features_done: 10,
      features_total: 12,
      open_bugs: 0,
      last_error: null,
      status: 'healthy',
    },
    {
      name: 'Integrations',
      icon: 'link',
      features_done: 5,
      features_total: 10,
      open_bugs: 0,
      last_error: null,
      status: 'warning',
    },
  ]

  const statusDots = {
    healthy: 'bg-green-500',
    warning: 'bg-amber-500',
    critical: 'bg-red-500',
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      <h3 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
        <Icon name="widgets" size="text-base" />
        Module Health
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {modules.map((module) => {
          const completionPercentage = (module.features_done / module.features_total) * 100

          return (
            <div
              key={module.name}
              className="p-4 bg-surface-container rounded-xl border border-outline-variant/10 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon name={module.icon} size="text-lg" className="text-primary" />
                  <div className="font-bold text-sm">{module.name}</div>
                </div>
                <div className={`w-2.5 h-2.5 rounded-full ${statusDots[module.status]}`} />
              </div>

              <div className="space-y-2 text-xs">
                <div>
                  <div className="text-on-surface-variant mb-1">
                    Features: {module.features_done}/{module.features_total}
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${completionPercentage}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-on-surface-variant">
                    Bugs: <strong className={module.open_bugs > 0 ? 'text-red-600' : 'text-green-600'}>{module.open_bugs}</strong>
                  </span>
                  {module.last_error && (
                    <span className="text-amber-600">Error: {module.last_error}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
