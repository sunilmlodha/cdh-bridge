'use client';

import { MOCK_NBA_DECISIONS } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { Brain } from 'lucide-react';

export default function NBAPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Brain size={24} className="text-pega-blue" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">NBA Decisions</h1>
          <p className="text-sm text-gray-500">Next Best Action decision log from Pega CDH</p>
        </div>
      </div>
      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Timestamp', 'Customer', 'Offer', 'Channel', 'Propensity', 'Outcome'].map((h) => (
                <th key={h} className="text-left text-xs text-gray-400 font-medium px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_NBA_DECISIONS.map((d) => (
              <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 text-xs font-mono text-gray-400">{new Date(d.timestamp).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs font-mono text-gray-600">{d.customerId}</td>
                <td className="px-4 py-3 text-sm font-medium text-gray-700">{d.offer}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{d.channel}</td>
                <td className="px-4 py-3 text-sm font-semibold text-pega-blue">{d.propensity}</td>
                <td className="px-4 py-3"><StatusBadge status={d.outcome} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
