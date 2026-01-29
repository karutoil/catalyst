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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Servers</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Create, start, and observe your game servers.
          </p>
        </div>
        <CreateServerModal />
      </div>
      <ServerFilters onChange={setFilters} />
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
