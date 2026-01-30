import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import { adminApi } from '../../services/api/admin';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useModManagerSettings, useSmtpSettings } from '../../hooks/useAdmin';

const parseReserved = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

function NetworkPage() {
  const [nodeId, setNodeId] = useState('');
  const [networkName, setNetworkName] = useState('mc-lan');
  const [cidr, setCidr] = useState('');
  const [gateway, setGateway] = useState('');
  const [startIp, setStartIp] = useState('');
  const [endIp, setEndIp] = useState('');
  const [reserved, setReserved] = useState('');
  const [autoFillIp, setAutoFillIp] = useState('');
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
  const [curseforgeApiKey, setCurseforgeApiKey] = useState('');
  const [modrinthApiKey, setModrinthApiKey] = useState('');
  const queryClient = useQueryClient();
  const { data: nodes = [] } = useNodes();
  const { data: pools = [], isLoading } = useQuery({
    queryKey: ['ip-pools'],
    queryFn: adminApi.listIpPools,
  });
  const { data: smtpSettings } = useSmtpSettings();
  const { data: modManagerSettings } = useModManagerSettings();
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === nodeId),
    [nodes, nodeId],
  );

  const canSubmit = useMemo(
    () => nodeId && networkName && cidr,
    [nodeId, networkName, cidr],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.createIpPool({
        nodeId,
        networkName,
        cidr,
        gateway: gateway || undefined,
        startIp: startIp || undefined,
        endIp: endIp || undefined,
        reserved: reserved ? parseReserved(reserved) : undefined,
      }),
    onSuccess: () => {
      notifySuccess('IP pool created');
      queryClient.invalidateQueries({ queryKey: ['ip-pools'] });
      setCidr('');
      setGateway('');
      setStartIp('');
      setEndIp('');
      setReserved('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create IP pool';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (poolId: string) => adminApi.deleteIpPool(poolId),
    onSuccess: () => {
      notifySuccess('IP pool removed');
      queryClient.invalidateQueries({ queryKey: ['ip-pools'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to remove IP pool';
      notifyError(message);
    },
  });

  const handleAutoFill = () => {
    if (!autoFillIp) return;
    const parts = autoFillIp.trim().split('.');
    if (parts.length < 3) return;
    const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
    setCidr(`${base}.0/24`);
    setGateway(`${base}.1`);
    setStartIp(`${base}.10`);
    setEndIp(`${base}.250`);
  };

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

  const updateModManagerMutation = useMutation({
    mutationFn: () =>
      adminApi.updateModManagerSettings({
        curseforgeApiKey: curseforgeApiKey.trim() || null,
        modrinthApiKey: modrinthApiKey.trim() || null,
      }),
    onSuccess: () => {
      notifySuccess('Mod manager settings updated');
      queryClient.invalidateQueries({ queryKey: ['admin-mod-manager'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update mod manager settings';
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

  useEffect(() => {
    if (!modManagerSettings) return;
    setCurseforgeApiKey(modManagerSettings.curseforgeApiKey ?? '');
    setModrinthApiKey(modManagerSettings.modrinthApiKey ?? '');
  }, [modManagerSettings]);

  return (
    <div className="space-y-4">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Network</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage IP pools for macvlan network allocations.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">IP Address Pools</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Allocate static macvlan IPs per node. Pools map to network names (e.g. mc-lan).
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            How this maps to allocations
          </div>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Catalyst uses IP pools for macvlan networking. Each server picks a primary IP from the pool,
            while port bindings (container → host ports) are configured on the server settings page.
          </p>
        </div>
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
          <div className="font-semibold text-slate-900 dark:text-slate-100">Quick setup</div>
          <div className="mt-1 text-slate-500 dark:text-slate-400">
            Paste a host IP to autofill a /24 pool. You can edit any field afterwards.
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block text-xs text-slate-500 dark:text-slate-300">
              Host IP
              <input
                className="mt-1 w-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                value={autoFillIp}
                onChange={(event) => setAutoFillIp(event.target.value)}
                placeholder={selectedNode?.publicAddress || '192.168.1.78'}
              />
            </label>
            <button
              type="button"
              className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
              onClick={handleAutoFill}
              disabled={!autoFillIp.trim()}
            >
              Autofill /24
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Node
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={nodeId}
              onChange={(event) => setNodeId(event.target.value)}
            >
              <option value="">Select node</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Network name
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={networkName}
              onChange={(event) => setNetworkName(event.target.value)}
              placeholder="mc-lan"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            CIDR
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={cidr}
              onChange={(event) => setCidr(event.target.value)}
              placeholder="192.168.50.0/24"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Gateway
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={gateway}
              onChange={(event) => setGateway(event.target.value)}
              placeholder="192.168.50.1"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Start IP (optional)
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={startIp}
              onChange={(event) => setStartIp(event.target.value)}
              placeholder="192.168.50.10"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            End IP (optional)
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={endIp}
              onChange={(event) => setEndIp(event.target.value)}
              placeholder="192.168.50.200"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300 md:col-span-3">
            Reserved IPs (comma or space separated)
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={reserved}
              onChange={(event) => setReserved(event.target.value)}
              rows={2}
              placeholder="192.168.50.20, 192.168.50.21"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Create pool
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              SMTP Configuration
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure outbound email for invites, alerts, and system notifications.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Host
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpHost}
              onChange={(event) => setSmtpHost(event.target.value)}
              placeholder="smtp.mailserver.com"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Port
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpPort}
              onChange={(event) => setSmtpPort(event.target.value)}
              placeholder="587"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Username
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpUsername}
              onChange={(event) => setSmtpUsername(event.target.value)}
              placeholder="user@example.com"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Password
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpPassword}
              onChange={(event) => setSmtpPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            From address
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpFrom}
              onChange={(event) => setSmtpFrom(event.target.value)}
              placeholder="no-reply@catalyst.local"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Reply-to
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpReplyTo}
              onChange={(event) => setSmtpReplyTo(event.target.value)}
              placeholder="support@catalyst.local"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Max connections
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpMaxConnections}
              onChange={(event) => setSmtpMaxConnections(event.target.value)}
              placeholder="5"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Max messages
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpMaxMessages}
              onChange={(event) => setSmtpMaxMessages(event.target.value)}
              placeholder="100"
            />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
              checked={smtpSecure}
              onChange={(event) => setSmtpSecure(event.target.checked)}
            />
            Use SSL/TLS
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
              checked={smtpRequireTls}
              onChange={(event) => setSmtpRequireTls(event.target.checked)}
            />
            Require STARTTLS
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
              checked={smtpPool}
              onChange={(event) => setSmtpPool(event.target.checked)}
            />
            Use connection pool
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={() => updateSmtpMutation.mutate()}
            disabled={updateSmtpMutation.isPending}
          >
            Save SMTP settings
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Mod Manager API Keys
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Provide API keys for CurseForge and Modrinth to enable mod downloads.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            CurseForge API Key
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={curseforgeApiKey}
              onChange={(event) => setCurseforgeApiKey(event.target.value)}
              placeholder="••••••••"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Modrinth API Key
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={modrinthApiKey}
              onChange={(event) => setModrinthApiKey(event.target.value)}
              placeholder="••••••••"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={() => updateModManagerMutation.mutate()}
            disabled={updateModManagerMutation.isPending}
          >
            Save mod manager keys
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {isLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
            Loading IP pools...
          </div>
        ) : pools.length === 0 ? (
          <EmptyState
            title="No IP pools yet"
            description="Create a pool to allocate static macvlan IPs."
          />
        ) : (
          pools.map((pool) => (
            <div
              key={pool.id}
              className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pool.nodeName} · {pool.networkName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">{pool.cidr}</div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                    Range: {pool.rangeStart} → {pool.rangeEnd}
                  </div>
                </div>
                <button
                  className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-400"
                  onClick={() => deleteMutation.mutate(pool.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
                  <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Available</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pool.availableCount}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
                  <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Used</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pool.usedCount}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
                  <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Reserved</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pool.reservedCount}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Total: {pool.total} · Gateway: {pool.gateway ?? 'n/a'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default NetworkPage;
