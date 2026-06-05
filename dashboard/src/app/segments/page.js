'use client';

import { useState } from 'react';
import { Tag, Users, TrendingUp, Plus } from 'lucide-react';
import clsx from 'clsx';

const SEGMENTS = [
  { id: 'seg-1', name: 'High Value', count: 142_834, ltv: 12480, growth: 4.2, tags: ['Gold', 'Platinum'] },
  { id: 'seg-2', name: 'Mortgage Holders', count: 389_210, ltv: 8920, growth: 1.8, tags: ['Product'] },
  { id: 'seg-3', name: 'Digital Engaged', count: 621_047, ltv: 4320, growth: 12.1, tags: ['Channel'] },
  { id: 'seg-4', name: 'Churn Risk', count: 28_419, ltv: 2100, growth: -3.4, tags: ['Risk'] },
  { id: 'seg-5', name: 'Recent Movers', count: 45_823, ltv: 3890, growth: 22.4, tags: ['Life Event'] },
  { id: 'seg-6', name: 'Investment Prospects', count: 78_234, ltv: 15820, growth: 8.7, tags: ['Prospect'] },
  { id: 'seg-7', name: 'Youth (18-30)', count: 234_891, ltv: 1240, growth: 5.3, tags: ['Age'] },
  { id: 'seg-8', name: 'Business Owners', count: 31_204, ltv: 28490, growth: 3.1, tags: ['Segment'] },
];

export default function SegmentsPage() {
  const [search, setSearch] = useState('');
  const filtered = SEGMENTS.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Segments</h1>
          <p className="text-sm text-gray-500 mt-0.5">{SEGMENTS.length} active segments synced from CDH</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus size={16} />
          New Segment
        </button>
      </div>

      <div className="card p-4">
        <input
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
          placeholder="Search segments…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {filtered.map((seg) => (
          <div key={seg.id} className="card hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-pega-light rounded-lg">
                  <Tag size={14} className="text-pega-blue" />
                </div>
                <h3 className="font-semibold text-gray-800">{seg.name}</h3>
              </div>
              <span className={clsx(
                'text-xs font-semibold',
                seg.growth > 0 ? 'text-green-600' : 'text-red-500'
              )}>
                {seg.growth > 0 ? '+' : ''}{seg.growth}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-400">Members</p>
                <p className="text-lg font-bold text-gray-900">{seg.count.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Avg LTV</p>
                <p className="text-lg font-bold text-gray-900">${seg.ltv.toLocaleString()}</p>
              </div>
            </div>
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {seg.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
