import { useEffect, useState } from 'react';
import type { ServerListParams, ServerStatus } from '../../types/server';

const statuses: ServerStatus[] = [
  'running',
  'stopped',
  'installing',
  'starting',
  'stopping',
  'crashed',
  'transferring',
  'suspended',
];

type Props = {
  onChange: (filters: ServerListParams) => void;
};

function ServerFilters({ onChange }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServerStatus | undefined>();

  useEffect(() => {
    const debounce = setTimeout(() => onChange({ search, status }), 200);
    return () => clearTimeout(debounce);
  }, [search, status, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
      <div className="flex-1 min-w-[200px]">
        <input
          type="search"
          placeholder="Search servers"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-primary-400"
        />
      </div>
      <select
        value={status ?? ''}
        onChange={(e) => setStatus(e.target.value ? (e.target.value as ServerStatus) : undefined)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-primary-400"
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

export default ServerFilters;
