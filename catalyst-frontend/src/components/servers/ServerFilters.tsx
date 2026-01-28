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
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="flex-1 min-w-[200px]">
        <input
          type="search"
          placeholder="Search servers"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
        />
      </div>
      <select
        value={status ?? ''}
        onChange={(e) => setStatus(e.target.value ? (e.target.value as ServerStatus) : undefined)}
        className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
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
