import { useEffect, useState } from 'react';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import { useAuditLogs } from '../../hooks/useAdmin';

const pageSize = 50;

function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState('24h');

  useEffect(() => {
    const now = new Date();
    const initialFrom = new Date(now);
    initialFrom.setHours(now.getHours() - 24);
    setFrom(initialFrom.toISOString().slice(0, 16));
    setTo(now.toISOString().slice(0, 16));
  }, []);

  const { data, isLoading } = useAuditLogs({
    page,
    limit: pageSize,
    action: action || undefined,
    resource: resource || undefined,
    userId: userId || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  const logs = data?.logs ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-semibold text-slate-50">Audit Logs</h1>
        <p className="text-sm text-slate-400">Track admin and user actions across the platform.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <label className="text-xs text-slate-300">
          Action contains
          <input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="server.create"
            className="mt-1 w-48 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <label className="text-xs text-slate-300">
          Resource
          <input
            value={resource}
            onChange={(event) => setResource(event.target.value)}
            placeholder="server"
            className="mt-1 w-40 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <label className="text-xs text-slate-300">
          User ID
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="cuid"
            className="mt-1 w-48 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <label className="text-xs text-slate-300">
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setRange('');
              setPage(1);
            }}
            className="mt-1 w-48 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <label className="text-xs text-slate-300">
          To
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setRange('');
              setPage(1);
            }}
            className="mt-1 w-48 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <label className="text-xs text-slate-300">
          Quick range
          <select
            value={range}
            onChange={(event) => {
              const next = event.target.value;
              setRange(next);
              if (!next) return;
              const now = new Date();
              const nextFrom = new Date(now);
              if (next === '1h') nextFrom.setHours(now.getHours() - 1);
              if (next === '6h') nextFrom.setHours(now.getHours() - 6);
              if (next === '24h') nextFrom.setHours(now.getHours() - 24);
              if (next === '7d') nextFrom.setDate(now.getDate() - 7);
              setFrom(nextFrom.toISOString().slice(0, 16));
              setTo(now.toISOString().slice(0, 16));
              setPage(1);
            }}
            className="mt-1 w-40 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            <option value="">Custom</option>
            <option value="1h">Last 1h</option>
            <option value="6h">Last 6h</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
          </select>
        </label>
        <button
          className="rounded-lg border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-700"
          onClick={() => {
            setAction('');
            setResource('');
            setUserId('');
            setFrom('');
            setTo('');
            setRange('24h');
            setPage(1);
          }}
        >
          Clear filters
        </button>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
          Loading audit logs...
        </div>
      ) : logs.length ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60">
          <div className="grid grid-cols-12 gap-3 border-b border-slate-800 px-4 py-3 text-xs uppercase text-slate-500">
            <div className="col-span-3">User</div>
            <div className="col-span-3">Action</div>
            <div className="col-span-2">Resource</div>
            <div className="col-span-2">IP</div>
            <div className="col-span-2 text-right">Timestamp</div>
          </div>
          <div className="divide-y divide-slate-800">
            {logs.map((log) => (
              <div key={log.id} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm text-slate-200">
                <div className="col-span-3">
                  <div className="font-semibold text-slate-100">
                    {log.user?.username ?? 'Unknown'}
                  </div>
                  <div className="text-xs text-slate-500">{log.user?.email ?? log.userId ?? 'n/a'}</div>
                </div>
                <div className="col-span-3 text-slate-100">{log.action}</div>
                <div className="col-span-2 text-slate-300">{log.resource}</div>
                <div className="col-span-2 text-xs text-slate-400">{log.ipAddress ?? 'n/a'}</div>
                <div className="col-span-2 text-right text-xs text-slate-400">
                  {new Date(log.timestamp).toLocaleString()}
                </div>
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
          title="No audit logs"
          description="Audit events will appear once user actions are recorded."
        />
      )}
    </div>
  );
}

export default AuditLogsPage;
