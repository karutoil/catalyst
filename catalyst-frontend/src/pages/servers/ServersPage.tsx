import { useMemo, useState } from 'react';
import ServerFilters from '../../components/servers/ServerFilters';
import ServerList from '../../components/servers/ServerList';
import CreateServerModal from '../../components/servers/CreateServerModal';
import { useServers } from '../../hooks/useServers';
import type { Server } from '../../types/server';

function ServersPage() {
  const [filters, setFilters] = useState({});
  const { data, isLoading } = useServers(filters);

  const filtered = useMemo(() => {
    if (!data) return [] as Server[];
    const { search, status } = filters as { search?: string; status?: string };
    return data.filter((server) => {
      const matchesStatus = status ? server.status === status : true;
      const matchesSearch = search
        ? server.name.toLowerCase().includes(search.toLowerCase()) ||
          server.nodeName?.toLowerCase().includes(search.toLowerCase())
        : true;
      return matchesStatus && matchesSearch;
    });
  }, [data, filters]);

  const statusCounts = useMemo(() => {
    const counts = {
      running: 0,
      stopped: 0,
      transitioning: 0,
      issues: 0,
    };
    data?.forEach((server) => {
      if (server.status === 'running') {
        counts.running += 1;
        return;
      }
      if (server.status === 'stopped') {
        counts.stopped += 1;
        return;
      }
      if (
        server.status === 'installing' ||
        server.status === 'starting' ||
        server.status === 'stopping' ||
        server.status === 'transferring'
      ) {
        counts.transitioning += 1;
        return;
      }
      if (server.status === 'crashed' || server.status === 'suspended') {
        counts.issues += 1;
      }
    });
    return counts;
  }, [data]);

  const totalServers = data?.length ?? 0;
  const filteredServers = filtered.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Servers</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Monitor fleet health, control power states, and launch new servers.
          </p>
        </div>
        <CreateServerModal />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total servers
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
            {totalServers}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {filteredServers === totalServers
              ? 'All servers visible'
              : `${filteredServers} match filters`}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Running
          </div>
          <div className="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
            {statusCounts.running}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Active game sessions
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Transitioning
          </div>
          <div className="mt-2 text-2xl font-semibold text-sky-600 dark:text-sky-400">
            {statusCounts.transitioning}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Installing or starting
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Needs attention
          </div>
          <div className="mt-2 text-2xl font-semibold text-rose-600 dark:text-rose-400">
            {statusCounts.issues}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Crashed or suspended
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ServerFilters onChange={setFilters} />
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:shadow-surface-dark">
            Showing {filteredServers} of {totalServers}
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
          Loading servers...
        </div>
      ) : (
        <ServerList servers={filtered} />
      )}
    </div>
  );
}

export default ServersPage;
