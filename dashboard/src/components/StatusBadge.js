'use client';

import clsx from 'clsx';

// Semantic colour tokens — map to CSS vars so editorial theme overrides work
const STATUS_MAP = {
  healthy:     { label: 'Healthy',     semantic: 'green'  },
  online:      { label: 'Online',      semantic: 'green'  },
  active:      { label: 'Active',      semantic: 'green'  },
  mapped:      { label: 'Mapped',      semantic: 'green'  },
  accepted:    { label: 'Accepted',    semantic: 'green'  },
  warning:     { label: 'Warning',     semantic: 'amber'  },
  degraded:    { label: 'Degraded',    semantic: 'amber'  },
  'in-progress':{ label: 'In Progress', semantic: 'blue'  },
  pending:     { label: 'Pending',     semantic: 'blue'   },
  error:       { label: 'Error',       semantic: 'red'    },
  offline:     { label: 'Offline',     semantic: 'red'    },
  escalated:   { label: 'Escalated',   semantic: 'red'    },
  rejected:    { label: 'Rejected',    semantic: 'red'    },
};

const SEMANTIC_STYLES = {
  green: {
    dot:  'bg-green-500',
    text: 'text-green-700',
    bg:   'bg-green-50',
    // editorial overrides via CSS vars
    style: { color: 'var(--accent-3)', background: 'color-mix(in srgb, var(--accent-3) 10%, transparent)' },
    dotStyle: { background: 'var(--accent-3)' },
  },
  amber: {
    dot:  'bg-amber-500',
    text: 'text-amber-700',
    bg:   'bg-amber-50',
    style: { color: 'var(--accent-4)', background: 'color-mix(in srgb, var(--accent-4) 10%, transparent)' },
    dotStyle: { background: 'var(--accent-4)' },
  },
  blue: {
    dot:  'bg-blue-400',
    text: 'text-blue-700',
    bg:   'bg-blue-50',
    style: { color: 'var(--accent-2)', background: 'color-mix(in srgb, var(--accent-2) 10%, transparent)' },
    dotStyle: { background: 'var(--accent-2)' },
  },
  red: {
    dot:  'bg-red-500',
    text: 'text-red-700',
    bg:   'bg-red-50',
    style: { color: 'var(--accent-1)', background: 'color-mix(in srgb, var(--accent-1) 10%, transparent)' },
    dotStyle: { background: 'var(--accent-1)' },
  },
};

export default function StatusBadge({ status, pulse = false }) {
  const config = STATUS_MAP[status?.toLowerCase()] ?? {
    label: status ?? 'Unknown',
    semantic: 'grey',
  };

  const sem = SEMANTIC_STYLES[config.semantic] ?? {
    dot: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-100',
    style: { color: 'var(--text-muted)', background: 'var(--bg-card-alt)' },
    dotStyle: {},
  };

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold"
      style={{ ...sem.style, borderRadius: 'var(--radius-sm)' }}
    >
      <span
        className={clsx('w-1.5 h-1.5 rounded-full', pulse && 'pulse-dot')}
        style={sem.dotStyle}
      />
      {config.label}
    </span>
  );
}
