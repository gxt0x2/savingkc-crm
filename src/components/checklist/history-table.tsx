import { Icon } from '@/components/ui/icon'
import type { ChecklistSubmission } from '@/types'

const mockHistory: ChecklistSubmission[] = [
  {
    id: '1',
    protocol_type: 'sod',
    team_member: 'Marcus V.',
    status: 'Verified',
    submitted_at: 'Today, 08:42 AM',
    notes: '3 New deals triaged.',
  },
  {
    id: '2',
    protocol_type: 'eod',
    team_member: 'Sarah L.',
    status: 'Verified',
    submitted_at: 'Yesterday, 05:15 PM',
    notes: 'Pipeline updated for Q4 review.',
  },
  {
    id: '3',
    protocol_type: 'sod',
    team_member: 'Sarah L.',
    status: 'Verified',
    submitted_at: 'Yesterday, 08:55 AM',
    notes: 'Ready for appointments.',
  },
]

export function HistoryTable() {
  return (
    <section className="mt-16 mb-24">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Submission History</h2>
          <p className="text-on-surface-variant">Verification audit trail for the current week.</p>
        </div>
        <div className="flex items-center gap-4 text-sm font-semibold">
          <span className="flex items-center gap-2 text-secondary">
            <span className="w-2 h-2 rounded-full bg-secondary" />
            98% Completion Rate
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl overflow-hidden shadow-[0_8px_24px_rgba(25,28,29,0.04)] border border-outline-variant/15">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant/20">
              <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Protocol Type</th>
              <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Team Member</th>
              <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Status</th>
              <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Timestamp</th>
              <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {mockHistory.map((row) => (
              <tr key={row.id} className="hover:bg-surface-container-lowest transition-colors">
                <td className="px-6 py-4">
                  {row.protocol_type === 'sod' ? (
                    <span className="px-3 py-1 rounded-full bg-primary text-white text-[10px] font-bold uppercase tracking-tighter">
                      SOD Protocol
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full bg-tertiary-container text-on-tertiary-container text-[10px] font-bold uppercase tracking-tighter">
                      EOD Protocol
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold text-on-surface-variant">
                      {row.team_member
                        .split(' ')
                        .map((n) => n[0])
                        .join('')}
                    </div>
                    <span className="font-semibold text-sm">{row.team_member}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-secondary font-bold text-sm">
                    <Icon name="check_circle" className="text-sm" filled />
                    {row.status}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-on-surface-variant">{row.submitted_at}</td>
                <td className="px-6 py-4 text-sm text-on-surface-variant font-medium">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
