import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import Input from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useAdminServers } from '../../hooks/useAdmin';
import type { AdminServer } from '../../types/admin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

const pageSize = 20;

function AdminServersPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [actionServer, setActionServer] = useState<AdminServer | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdminServers({
    page,
    limit: pageSize,
    status: status || undefined,
    search: search.trim() || undefined,
  });

  const servers = data?.servers ?? [];
  const pagination = data?.pagination;

  const statuses = useMemo(
    () => Array.from(new Set(servers.map((server) => server.status))).sort(),
    [servers],
  );

  const suspendMutation = useMutation({
    mutationFn: (payload: { serverId: string; reason?: string }) =>
      adminApi.suspendServer(payload.serverId, payload.reason),
    onSuccess: () => {
      notifySuccess('Server suspended');
      queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      setActionServer(null);
      setSuspendReason('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to suspend server';
      notifyError(message);
    },
  });

  const unsuspendMutation = useMutation({
    mutationFn: (serverId: string) => adminApi.unsuspendServer(serverId),
    onSuccess: () => {
      notifySuccess('Server unsuspended');
      queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      setActionServer(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to unsuspend server';
      notifyError(message);
    },
  });

  return (
    <div className="space-y-4">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">All Servers</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">View every server across all nodes.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 px-4 py-3">
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Search
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search servers"
            className="mt-1 w-56"
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Status
          <Select
            value={status || 'all'}
            onValueChange={(value) => {
              setStatus(value === 'all' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger className="mt-1 w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-4 py-6 text-slate-600 dark:text-slate-200">
          Loading servers...
        </div>
      ) : servers.length ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60">
          <div className="grid grid-cols-12 gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3 text-xs uppercase text-slate-500 dark:text-slate-500">
            <div className="col-span-3">Server</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-3">Node</div>
            <div className="col-span-2">Template</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          <div className="divide-y divide-slate-800">
            {servers.map((server: AdminServer) => (
              <div key={server.id} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm text-slate-600 dark:text-slate-200">
                <div className="col-span-3">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{server.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-500">{server.id}</div>
                </div>
                <div className="col-span-2 text-slate-900 dark:text-slate-100">{server.status}</div>
                <div className="col-span-3">
                  <div className="text-slate-900 dark:text-slate-100">{server.node.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-500">{server.node.hostname}</div>
                </div>
                <div className="col-span-2 text-slate-600 dark:text-slate-300">{server.template.name}</div>
                <div className="col-span-2 flex justify-end gap-2 text-xs">
                  {server.status === 'suspended' ? (
                    <button
                      className="rounded-md border border-emerald-600 px-2 py-1 text-emerald-200 hover:border-emerald-500 disabled:opacity-60"
                      onClick={() => unsuspendMutation.mutate(server.id)}
                      disabled={unsuspendMutation.isPending}
                    >
                      Unsuspend
                    </button>
                  ) : (
                    <button
                      className="rounded-md border border-rose-700 px-2 py-1 text-rose-200 hover:border-rose-500 disabled:opacity-60"
                      onClick={() => {
                        setActionServer(server);
                        setSuspendReason('');
                      }}
                      disabled={suspendMutation.isPending}
                    >
                      Suspend
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {pagination ? (
            <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-200 dark:border-slate-800 px-2 py-1 text-xs text-slate-600 dark:text-slate-200 disabled:opacity-50"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  className="rounded-md border border-slate-200 dark:border-slate-800 px-2 py-1 text-xs text-slate-600 dark:text-slate-200 disabled:opacity-50"
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
          title={search.trim() ? 'No servers found' : 'No servers'}
          description={
            search.trim()
              ? 'Try a different server name, ID, or node.'
              : 'No servers match the selected status filter.'
          }
        />
      )}
      {actionServer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Suspend server</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setActionServer(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-900 dark:text-slate-100">
              <div className="text-xs text-slate-500 dark:text-slate-400">Server: {actionServer.name}</div>
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">Reason (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                  value={suspendReason}
                  onChange={(event) => setSuspendReason(event.target.value)}
                  placeholder="e.g., Billing issue"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setActionServer(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-rose-600 px-4 py-2 font-semibold text-white shadow-lg shadow-rose-500/20 transition-all duration-300 hover:bg-rose-500 disabled:opacity-60"
                onClick={() =>
                  suspendMutation.mutate({
                    serverId: actionServer.id,
                    reason: suspendReason.trim() || undefined,
                  })
                }
                disabled={suspendMutation.isPending}
              >
                Suspend
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminServersPage;
