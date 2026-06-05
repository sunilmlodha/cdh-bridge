'use client';

import clsx from 'clsx';

export default function KpiCard({ title, value, delta, icon: Icon, loading, color = 'blue', suffix = '' }) {
  const deltaPositive = delta > 0;
  const deltaZero = delta === 0 || delta === undefined;

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">{title}</span>
        {Icon && (
          <div className={clsx(
            'p-2 rounded-lg',
            color === 'blue' && 'bg-pega-light text-pega-blue',
            color === 'green' && 'bg-green-50 text-green-600',
            color === 'orange' && 'bg-orange-50 text-orange-600',
            color === 'purple' && 'bg-purple-50 text-purple-600',
          )}>
            <Icon size={18} />
          </div>
        )}
      </div>
      <div className="flex items-end justify-between">
        <div>
          {loading ? (
            <div className="h-8 w-24 bg-gray-100 rounded animate-pulse" />
          ) : (
            <span className="text-2xl font-bold text-gray-900">
              {value ?? '—'}{suffix}
            </span>
          )}
        </div>
        {!deltaZero && !loading && (
          <span className={clsx(
            'text-xs font-semibold px-2 py-1 rounded-full',
            deltaPositive ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
          )}>
            {deltaPositive ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      {!loading && delta !== undefined && (
        <p className="text-xs text-gray-400">
          {deltaPositive ? '▲' : deltaZero ? '—' : '▼'} vs. last 24h
        </p>
      )}
    </div>
  );
}
