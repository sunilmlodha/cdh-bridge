'use client';

import clsx from 'clsx';

const STATUS_MAP = {
  healthy: { label: 'Healthy', dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  online: { label: 'Online', dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  active: { label: 'Active', dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  warning: { label: 'Warning', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
  degraded: { label: 'Degraded', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
  error: { label: 'Error', dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
  offline: { label: 'Offline', dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
  pending: { label: 'Pending', dot: 'bg-blue-400', text: 'text-blue-700', bg: 'bg-blue-50' },
  'in-progress': { label: 'In Progress', dot: 'bg-pega-blue', text: 'text-pega-blue', bg: 'bg-pega-light' },
  escalated: { label: 'Escalated', dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
  mapped: { label: 'Mapped', dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  accepted: { label: 'Accepted', dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  rejected: { label: 'Rejected', dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
};

export default function StatusBadge({ status, pulse = false }) {
  const config = STATUS_MAP[status?.toLowerCase()] ?? {
    label: status ?? 'Unknown',
    dot: 'bg-gray-400',
    text: 'text-gray-600',
    bg: 'bg-gray-100',
  };

  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold', config.bg, config.text)}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', config.dot, pulse && 'pulse-dot')} />
      {config.label}
    </span>
  );
}
