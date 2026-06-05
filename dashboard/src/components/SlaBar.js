'use client';

import clsx from 'clsx';

export default function SlaBar({ daysElapsed, slaDays, showLabel = true }) {
  const pct = Math.min((daysElapsed / slaDays) * 100, 100);
  const daysLeft = Math.max(slaDays - daysElapsed, 0);
  const breached = daysLeft === 0;

  const barColor = pct >= 90
    ? 'bg-red-500'
    : pct >= 70
    ? 'bg-amber-500'
    : 'bg-pega-blue';

  return (
    <div className="flex flex-col gap-1 w-full">
      {showLabel && (
        <div className="flex justify-between text-xs text-gray-500">
          <span>{daysElapsed}d elapsed</span>
          <span className={clsx('font-semibold', breached ? 'text-red-600' : daysLeft <= 3 ? 'text-amber-600' : 'text-gray-600')}>
            {breached ? 'BREACHED' : `${daysLeft}d left`}
          </span>
        </div>
      )}
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
