import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AdminTabs from '../../components/admin/AdminTabs';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useAdminHealth, useAdminStats, useSmtpSettings } from '../../hooks/useAdmin';

function SystemPage() {
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpReplyTo, setSmtpReplyTo] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpRequireTls, setSmtpRequireTls] = useState(false);
  const [smtpPool, setSmtpPool] = useState(false);
  const [smtpMaxConnections, setSmtpMaxConnections] = useState('');
  const [smtpMaxMessages, setSmtpMaxMessages] = useState('');
  const queryClient = useQueryClient();
  const { data: stats } = useAdminStats();
  const { data: health } = useAdminHealth();
  const { data: smtpSettings } = useSmtpSettings();


  const updateSmtpMutation = useMutation({
    mutationFn: () =>
      adminApi.updateSmtpSettings({
        host: smtpHost.trim() || null,
        port: smtpPort.trim() ? Number(smtpPort) : null,
        username: smtpUsername.trim() || null,
        password: smtpPassword || null,
        from: smtpFrom.trim() || null,
        replyTo: smtpReplyTo.trim() || null,
        secure: smtpSecure,
        requireTls: smtpRequireTls,
        pool: smtpPool,
        maxConnections: smtpMaxConnections.trim() ? Number(smtpMaxConnections) : null,
        maxMessages: smtpMaxMessages.trim() ? Number(smtpMaxMessages) : null,
      }),
    onSuccess: () => {
      notifySuccess('SMTP settings updated');
      queryClient.invalidateQueries({ queryKey: ['admin-smtp'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update SMTP settings';
      notifyError(message);
    },
  });

  useEffect(() => {
    if (!smtpSettings) return;
    setSmtpHost(smtpSettings.host ?? '');
    setSmtpPort(smtpSettings.port ? String(smtpSettings.port) : '587');
    setSmtpUsername(smtpSettings.username ?? '');
    setSmtpPassword(smtpSettings.password ?? '');
    setSmtpFrom(smtpSettings.from ?? '');
    setSmtpReplyTo(smtpSettings.replyTo ?? '');
    setSmtpSecure(Boolean(smtpSettings.secure));
    setSmtpRequireTls(Boolean(smtpSettings.requireTls));
    setSmtpPool(Boolean(smtpSettings.pool));
    setSmtpMaxConnections(
      smtpSettings.maxConnections !== null && smtpSettings.maxConnections !== undefined
        ? String(smtpSettings.maxConnections)
        : '',
    );
    setSmtpMaxMessages(
      smtpSettings.maxMessages !== null && smtpSettings.maxMessages !== undefined
        ? String(smtpSettings.maxMessages)
        : '',
    );
  }, [smtpSettings]);

  return (
    <div className="space-y-4">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-semibold text-slate-50">System Health</h1>
        <p className="text-sm text-slate-400">Monitor global health and system statistics.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs uppercase text-slate-500">Status</div>
          <div className="mt-2 text-lg font-semibold text-slate-100">
            {health?.status ?? 'loading'}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Database: {health?.database ?? 'checking'}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Checked {health ? new Date(health.timestamp).toLocaleTimeString() : '...'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs uppercase text-slate-500">Nodes</div>
          <div className="mt-2 text-lg font-semibold text-slate-100">
            {health?.nodes.online ?? 0} online / {health?.nodes.total ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Offline: {health?.nodes.offline ?? 0} · Stale: {health?.nodes.stale ?? 0}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs uppercase text-slate-500">System totals</div>
          <div className="mt-2 text-lg font-semibold text-slate-100">
            {stats?.servers ?? 0} servers
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Users: {stats?.users ?? 0} · Active: {stats?.activeServers ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-400">Nodes: {stats?.nodes ?? 0}</div>
        </div>
      </div>


      <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">SMTP Configuration</h2>
            <p className="text-xs text-slate-400">
              Configure outbound email for invites, alerts, and system notifications.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-300">
            Host
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={smtpHost}
              onChange={(event) => setSmtpHost(event.target.value)}
              placeholder="smtp.mailserver.com"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Port
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={smtpPort}
              onChange={(event) => setSmtpPort(event.target.value)}
              placeholder="587"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Username
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={smtpUsername}
              onChange={(event) => setSmtpUsername(event.target.value)}
              placeholder="user@example.com"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Password
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={smtpPassword}
              onChange={(event) => setSmtpPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>
          <label className="block text-xs text-slate-300">
            From address
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={smtpFrom}
              onChange={(event) => setSmtpFrom(event.target.value)}
              placeholder="no-reply@catalyst.local"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Reply-to
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={smtpReplyTo}
              onChange={(event) => setSmtpReplyTo(event.target.value)}
              placeholder="support@catalyst.local"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Max connections
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={smtpMaxConnections}
              onChange={(event) => setSmtpMaxConnections(event.target.value)}
              placeholder="5"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Max messages
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={smtpMaxMessages}
              onChange={(event) => setSmtpMaxMessages(event.target.value)}
              placeholder="100"
            />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-700 bg-slate-900"
              checked={smtpSecure}
              onChange={(event) => setSmtpSecure(event.target.checked)}
            />
            Use SSL/TLS
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-700 bg-slate-900"
              checked={smtpRequireTls}
              onChange={(event) => setSmtpRequireTls(event.target.checked)}
            />
            Require STARTTLS
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-700 bg-slate-900"
              checked={smtpPool}
              onChange={(event) => setSmtpPool(event.target.checked)}
            />
            Use connection pool
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
            onClick={() => updateSmtpMutation.mutate()}
            disabled={updateSmtpMutation.isPending}
          >
            Save SMTP settings
          </button>
        </div>
      </div>
    </div>
  );
}

export default SystemPage;
