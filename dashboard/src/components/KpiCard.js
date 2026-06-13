'use client';

import clsx from 'clsx';

export default function KpiCard({ title, value, delta, icon: Icon, loading, color = 'blue', suffix = '' }) {
  const deltaPositive = delta > 0;
  const deltaZero = delta === 0 || delta === undefined;

  // Icon bg/text — uses CSS vars for editorial, Tailwind for default
  const iconStyle = {
    blue:   { background: 'color-mix(in srgb, var(--accent-2) 12%, transparent)', color: 'var(--accent-2)' },
    green:  { background: 'color-mix(in srgb, var(--accent-3) 12%, transparent)', color: 'var(--accent-3)' },
    orange: { background: 'color-mix(in srgb, var(--accent-4) 12%, transparent)', color: 'var(--accent-4)' },
    purple: { background: 'color-mix(in srgb, var(--accent-1) 12%, transparent)', color: 'var(--accent-1)' },
  }[color] ?? {};

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
          {title}
        </span>
        {Icon && (
          <div className="p-2 rounded-lg" style={iconStyle}>
            <Icon size={18} />
          </div>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          {loading ? (
            <div className="h-8 w-24 rounded animate-pulse" style={{ background: 'var(--border)' }} />
          ) : (
            <span
              className="text-2xl font-bold stat-value"
              style={{ color: 'var(--text)' }}
            >
              {value ?? '—'}{suffix}
            </span>
          )}
        </div>
        {!deltaZero && !loading && (
          <span
            className="text-xs font-semibold px-2 py-1 rounded-full"
            style={{
              color:      deltaPositive ? 'var(--accent-3)' : 'var(--dcs-red, #dc2626)',
              background: deltaPositive
                ? 'color-mix(in srgb, var(--accent-3) 10%, transparent)'
                : 'color-mix(in srgb, var(--accent-1) 10%, transparent)',
            }}
          >
            {deltaPositive ? '+' : ''}{delta}%
          </span>
        )}
      </div>

      {!loading && delta !== undefined && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {deltaPositive ? '▲' : deltaZero ? '—' : '▼'} vs. last 24h
        </p>
      )}
    </div>
  );
}
