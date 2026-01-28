import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import { adminApi } from '../../services/api/admin';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useAdminHealth, useAdminStats, useDatabaseHosts } from '../../hooks/useAdmin';

const parseReserved = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

function SystemPage() {
  const [nodeId, setNodeId] = useState('');
  const [networkName, setNetworkName] = useState('mc-lan');
  const [cidr, setCidr] = useState('');
  const [gateway, setGateway] = useState('');
  const [startIp, setStartIp] = useState('');
  const [endIp, setEndIp] = useState('');
  const [reserved, setReserved] = useState('');
  const [dbHostId, setDbHostId] = useState<string | null>(null);
  const [dbName, setDbName] = useState('');
  const [dbHost, setDbHost] = useState('');
  const [dbPort, setDbPort] = useState('3306');
  const [dbUsername, setDbUsername] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const queryClient = useQueryClient();
  const { data: nodes = [] } = useNodes();
  const { data: pools = [], isLoading } = useQuery({
    queryKey: ['ip-pools'],
    queryFn: adminApi.listIpPools,
  });
  const { data: stats } = useAdminStats();
  const { data: health } = useAdminHealth();
  const { data: databaseHosts = [], isLoading: dbHostsLoading } = useDatabaseHosts();

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

  const createHostMutation = useMutation({
    mutationFn: () =>
      adminApi.createDatabaseHost({
        name: dbName.trim(),
        host: dbHost.trim(),
        port: dbPort ? Number(dbPort) : undefined,
        username: dbUsername.trim(),
        password: dbPassword,
      }),
    onSuccess: () => {
      notifySuccess('Database host created');
      queryClient.invalidateQueries({ queryKey: ['admin-database-hosts'] });
      setDbName('');
      setDbHost('');
      setDbPort('3306');
      setDbUsername('');
      setDbPassword('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create database host';
      notifyError(message);
    },
  });

  const updateHostMutation = useMutation({
    mutationFn: (payload: { hostId: string }) =>
      adminApi.updateDatabaseHost(payload.hostId, {
        name: dbName.trim(),
        host: dbHost.trim(),
        port: dbPort ? Number(dbPort) : undefined,
        username: dbUsername.trim(),
        password: dbPassword || undefined,
      }),
    onSuccess: () => {
      notifySuccess('Database host updated');
      queryClient.invalidateQueries({ queryKey: ['admin-database-hosts'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update database host';
      notifyError(message);
    },
  });

  const deleteHostMutation = useMutation({
    mutationFn: (hostId: string) => adminApi.deleteDatabaseHost(hostId),
    onSuccess: () => {
      notifySuccess('Database host removed');
      queryClient.invalidateQueries({ queryKey: ['admin-database-hosts'] });
      setDbHostId(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete database host';
      notifyError(message);
    },
  });

  const canSubmitDbHost = useMemo(
    () => dbName.trim() && dbHost.trim() && dbUsername.trim() && dbPassword.trim(),
    [dbName, dbHost, dbUsername, dbPassword],
  );

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
            <h2 className="text-lg font-semibold text-slate-100">IP Address Pools</h2>
            <p className="text-xs text-slate-400">
              Allocate static macvlan IPs per node. Pools map to network names (e.g. mc-lan).
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-300">
            Node
            <select
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
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
          <label className="block text-xs text-slate-300">
            Network name
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={networkName}
              onChange={(event) => setNetworkName(event.target.value)}
              placeholder="mc-lan"
            />
          </label>
          <label className="block text-xs text-slate-300">
            CIDR
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={cidr}
              onChange={(event) => setCidr(event.target.value)}
              placeholder="192.168.50.0/24"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Gateway
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={gateway}
              onChange={(event) => setGateway(event.target.value)}
              placeholder="192.168.50.1"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Start IP (optional)
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={startIp}
              onChange={(event) => setStartIp(event.target.value)}
              placeholder="192.168.50.10"
            />
          </label>
          <label className="block text-xs text-slate-300">
            End IP (optional)
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={endIp}
              onChange={(event) => setEndIp(event.target.value)}
              placeholder="192.168.50.200"
            />
          </label>
          <label className="block text-xs text-slate-300 md:col-span-3">
            Reserved IPs (comma or space separated)
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={reserved}
              onChange={(event) => setReserved(event.target.value)}
              rows={2}
              placeholder="192.168.50.20, 192.168.50.21"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Create pool
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Database Hosts</h2>
            <p className="text-xs text-slate-400">
              Register MySQL hosts used to provision per-server databases.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-300">
            Name
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={dbName}
              onChange={(event) => setDbName(event.target.value)}
              placeholder="primary-mysql"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Host
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={dbHost}
              onChange={(event) => setDbHost(event.target.value)}
              placeholder="mysql.internal"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Port
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={dbPort}
              onChange={(event) => setDbPort(event.target.value)}
              placeholder="3306"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Username
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={dbUsername}
              onChange={(event) => setDbUsername(event.target.value)}
              placeholder="catalyst_admin"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Password
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              value={dbPassword}
              onChange={(event) => setDbPassword(event.target.value)}
              placeholder="secret"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
            disabled={!canSubmitDbHost || createHostMutation.isPending}
            onClick={() => createHostMutation.mutate()}
          >
            Create host
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {isLoading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-300">
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
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    {pool.nodeName} · {pool.networkName}
                  </div>
                  <div className="text-xs text-slate-400">{pool.cidr}</div>
                  <div className="mt-2 text-xs text-slate-400">
                    Range: {pool.rangeStart} → {pool.rangeEnd}
                  </div>
                </div>
                <button
                  className="rounded-md border border-rose-700 px-2 py-1 text-xs text-rose-200 hover:border-rose-500"
                  onClick={() => deleteMutation.mutate(pool.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="text-slate-400">Available</div>
                  <div className="text-sm font-semibold text-slate-100">{pool.availableCount}</div>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="text-slate-400">Used</div>
                  <div className="text-sm font-semibold text-slate-100">{pool.usedCount}</div>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="text-slate-400">Reserved</div>
                  <div className="text-sm font-semibold text-slate-100">{pool.reservedCount}</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-400">
                Total: {pool.total} · Gateway: {pool.gateway ?? 'n/a'}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {dbHostsLoading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-300">
            Loading database hosts...
          </div>
        ) : databaseHosts.length === 0 ? (
          <EmptyState
            title="No database hosts yet"
            description="Create a host to provision databases for servers."
          />
        ) : (
          databaseHosts.map((dbHostEntry) => (
            <div
              key={dbHostEntry.id}
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{dbHostEntry.name}</div>
                  <div className="text-xs text-slate-400">
                    {dbHostEntry.host}:{dbHostEntry.port}
                  </div>
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:border-slate-500"
                    onClick={() => {
                      setDbHostId(dbHostEntry.id);
                      setDbName(dbHostEntry.name);
                      setDbHost(dbHostEntry.host);
                      setDbPort(String(dbHostEntry.port));
                      setDbUsername(dbHostEntry.username);
                      setDbPassword(dbHostEntry.password);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded-md border border-rose-700 px-2 py-1 text-rose-200 hover:border-rose-500 disabled:opacity-60"
                    onClick={() => deleteHostMutation.mutate(dbHostEntry.id)}
                    disabled={deleteHostMutation.isPending}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {dbHostId === dbHostEntry.id ? (
                <div className="mt-4 space-y-3 text-xs text-slate-300">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block">
                      Name
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                        value={dbName}
                        onChange={(event) => setDbName(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      Host
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                        value={dbHost}
                        onChange={(event) => setDbHost(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      Port
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                        value={dbPort}
                        onChange={(event) => setDbPort(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      Username
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                        value={dbUsername}
                        onChange={(event) => setDbUsername(event.target.value)}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      Password
                      <input
                        type="password"
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                        value={dbPassword}
                        onChange={(event) => setDbPassword(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                      onClick={() => updateHostMutation.mutate({ hostId: dbHostEntry.id })}
                      disabled={updateHostMutation.isPending}
                    >
                      Save
                    </button>
                    <button
                      className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
                      onClick={() => setDbHostId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default SystemPage;
