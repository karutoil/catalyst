import { useState } from 'react';
import type { MetricsTimeRange } from '../../hooks/useServerMetricsHistory';

const PRESET_RANGES: MetricsTimeRange[] = [
  { hours: 1, limit: 60, label: '1 hour' },
  { hours: 6, limit: 100, label: '6 hours' },
  { hours: 24, limit: 144, label: '24 hours' },
  { hours: 168, limit: 300, label: '7 days' },
  { hours: 720, limit: 500, label: '30 days' },
];

interface MetricsTimeRangeSelectorProps {
  selectedRange: MetricsTimeRange;
  onRangeChange: (range: MetricsTimeRange) => void;
}

function MetricsTimeRangeSelector({ selectedRange, onRangeChange }: MetricsTimeRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customHours, setCustomHours] = useState<string>('');
  const [customLimit, setCustomLimit] = useState<string>('');

  const handlePresetClick = (range: MetricsTimeRange) => {
    onRangeChange(range);
    setIsOpen(false);
    setCustomHours('');
    setCustomLimit('');
  };

  const handleCustomSubmit = () => {
    const hours = Number(customHours);
    const limit = Number(customLimit);

    if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) {
      alert('Hours must be between 1 and 8760 (1 year)');
      return;
    }

    if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
      alert('Limit must be between 1 and 1000 data points');
      return;
    }

    onRangeChange({
      hours,
      limit,
      label: `${hours}h (${limit} points)`,
    });
    setIsOpen(false);
    setCustomHours('');
    setCustomLimit('');
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary-500/30"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{selectedRange.label}</span>
        <svg className={`h-4 w-4 transition ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-2 w-48 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-1 p-2">
            {PRESET_RANGES.map((range) => (
              <button
                key={range.label}
                type="button"
                className={`w-full rounded-md px-3 py-2 text-left text-xs font-medium transition-all duration-300 ${
                  selectedRange.label === range.label
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
                onClick={() => handlePresetClick(range)}
              >
                {range.label}
              </button>
            ))}
            <div className="border-t border-slate-200 pt-2 dark:border-slate-800">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Custom range
              </div>
              <div className="space-y-2 px-3 pb-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Hours
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="8760"
                    value={customHours}
                    onChange={(e) => setCustomHours(e.target.value)}
                    placeholder="24"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder-slate-400 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-primary-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Data points
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={customLimit}
                    onChange={(e) => setCustomLimit(e.target.value)}
                    placeholder="144"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder-slate-400 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-primary-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  disabled={!customHours || !customLimit}
                  className="w-full rounded-md bg-primary-600 px-2 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MetricsTimeRangeSelector;
