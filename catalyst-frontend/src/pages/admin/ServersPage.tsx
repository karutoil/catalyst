import { useMemo, useState } from 'react';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import { useAdminServers } from '../../hooks/useAdmin';
import type { AdminServer } from '../../types/admin';

const pageSize = 20;

function AdminServersPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, isLoading } = useAdminServers({
    page,
    limit: pageSize,
    status: status || undefined,
  });

  const servers = data?.servers ?? [];
  const pagination = data?.pagination;

  const statuses = useMemo(
    () => Array.from(new Set(servers.map((server) => server.status))).sort(),
    [servers],
  );

  return (
    <div className="space-y-4">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-semibold text-slate-50">All Servers</h1>
        <p className="text-sm text-slate-400">View every server across all nodes.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <label className="text-xs text-slate-300">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="mt-1 w-44 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All statuses</option>
            {statuses.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
          Loading servers...
        </div>
      ) : servers.length ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60">
          <div className="grid grid-cols-12 gap-3 border-b border-slate-800 px-4 py-3 text-xs uppercase text-slate-500">
            <div className="col-span-4">Server</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-3">Node</div>
            <div className="col-span-3">Template</div>
          </div>
          <div className="divide-y divide-slate-800">
            {servers.map((server: AdminServer) => (
              <div key={server.id} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm text-slate-200">
                <div className="col-span-4">
                  <div className="font-semibold text-slate-100">{server.name}</div>
                  <div className="text-xs text-slate-500">{server.id}</div>
                </div>
                <div className="col-span-2 text-slate-100">{server.status}</div>
                <div className="col-span-3">
                  <div className="text-slate-100">{server.node.name}</div>
                  <div className="text-xs text-slate-500">{server.node.hostname}</div>
                </div>
                <div className="col-span-3 text-slate-300">{server.template.name}</div>
              </div>
            ))}
          </div>
          {pagination ? (
            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
                  onClick={() => setPage((prev) => (pagination.page < pagination.totalPages ? prev + 1 : prev))}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="No servers"
          description="No servers match the selected status filter."
        />
      )}
    </div>
  );
}

export default AdminServersPage;
