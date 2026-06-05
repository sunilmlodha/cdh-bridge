'use client';

import { FileText } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';

const AUDIT_ENTRIES = Array.from({ length: 40 }, (_, i) => ({
  id: `audit-${i}`,
  ts: new Date(Date.now() - i * 3600000).toISOString(),
  action: ['Profile Updated', 'Connector Synced', 'Consent Changed', 'Event Ingested', 'Erasure Request', 'Opt-Out Applied'][i % 6],
  user: ['admin@bank.com', 'system', 'api-key-3', 'connector-svc'][i % 4],
  resource: `CUST-${Math.floor(Math.random() * 900000) + 100000}`,
  result: i % 10 === 0 ? 'error' : 'completed',
  ip: `10.0.${Math.floor(i / 5)}.${i % 256}`,
}));

export default function AuditPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileText size={24} className="text-gray-500" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500">Complete activity log for all CDH Bridge operations</p>
        </div>
      </div>
      <div className="card p-0 overflow-hidden">
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
              <tr>
                {['Timestamp', 'Action', 'User', 'Resource', 'IP', 'Result'].map((h) => (
                  <th key={h} className="text-left text-xs text-gray-400 font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AUDIT_ENTRIES.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-400">{new Date(e.ts).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-700 font-medium">{e.action}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{e.user}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-pega-blue">{e.resource}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-400">{e.ip}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={e.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
