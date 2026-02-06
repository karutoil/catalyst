import { useMemo, useState } from 'react';
import ServerFilters from '../../components/servers/ServerFilters';
import ServerList from '../../components/servers/ServerList';
import CreateServerModal from '../../components/servers/CreateServerModal';
import { useServers } from '../../hooks/useServers';
import type { Server } from '../../types/server';
import { useAuthStore } from '../../stores/authStore';

function ServersPage() {
  const [filters, setFilters] = useState({});
  const { data, isLoading } = useServers(filters);
  const { user } = useAuthStore();
  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create');

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
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Servers</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Manage your game servers, monitor resources, and control power states
            </p>
          </div>
          {canCreateServer ? (
            <div className="flex items-center gap-2">
              <CreateServerModal />
            </div>
          ) : null}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          onClick={() => setFilters({})}
          className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-surface-light transition-all duration-300 hover:scale-105 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total
            </div>
            <div className="rounded-full bg-slate-100 p-2 transition-all duration-300 group-hover:bg-primary-100 dark:bg-slate-800 dark:group-hover:bg-primary-900/30">
              <svg className="h-4 w-4 text-slate-600 transition-all duration-300 group-hover:text-primary-600 dark:text-slate-400 dark:group-hover:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
              </svg>
            </div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900 dark:text-white">
            {totalServers}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {filteredServers === totalServers ? 'All servers' : `${filteredServers} visible`}
          </div>
        </button>

        <button
          onClick={() => setFilters({ status: 'running' })}
          className="group rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left shadow-surface-light transition-all duration-300 hover:scale-105 hover:border-emerald-400 dark:border-emerald-500/30 dark:bg-emerald-950/20 dark:shadow-surface-dark dark:hover:border-emerald-500/50"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Running
            </div>
            <div className="rounded-full bg-emerald-200 p-2 transition-all duration-300 group-hover:bg-emerald-300 dark:bg-emerald-900/50 dark:group-hover:bg-emerald-900/70">
              <svg className="h-4 w-4 text-emerald-700 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="mt-3 text-3xl font-bold text-emerald-700 dark:text-emerald-400">
            {statusCounts.running}
          </div>
          <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-500">
            Active right now
          </div>
        </button>

        <button
          onClick={() => setFilters({ status: 'stopped' })}
          className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-surface-light transition-all duration-300 hover:scale-105 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-slate-600"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Stopped
            </div>
            <div className="rounded-full bg-slate-200 p-2 transition-all duration-300 group-hover:bg-slate-300 dark:bg-slate-800 dark:group-hover:bg-slate-700">
              <svg className="h-4 w-4 text-slate-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            </div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-700 dark:text-slate-300">
            {statusCounts.stopped}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ready to start
          </div>
        </button>

        <button
          onClick={() => setFilters({ status: 'crashed' })}
          className="group rounded-xl border border-rose-200 bg-rose-50 p-4 text-left shadow-surface-light transition-all duration-300 hover:scale-105 hover:border-rose-400 dark:border-rose-500/30 dark:bg-rose-950/20 dark:shadow-surface-dark dark:hover:border-rose-500/50"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
              Issues
            </div>
            <div className="rounded-full bg-rose-200 p-2 transition-all duration-300 group-hover:bg-rose-300 dark:bg-rose-900/50 dark:group-hover:bg-rose-900/70">
              <svg className="h-4 w-4 text-rose-700 dark:text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
          <div className="mt-3 text-3xl font-bold text-rose-700 dark:text-rose-400">
            {statusCounts.issues}
          </div>
          <div className="mt-1 text-xs text-rose-600 dark:text-rose-500">
            Needs attention
          </div>
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
        <div className="px-4 py-3">
          <ServerFilters onChange={setFilters} />
        </div>
      </div>

      {/* Server List */}
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary-600 dark:border-slate-700 dark:border-t-primary-400"></div>
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">Loading servers...</p>
        </div>
      ) : (
        <ServerList servers={filtered} />
      )}
    </div>
  );
}

export default ServersPage;
