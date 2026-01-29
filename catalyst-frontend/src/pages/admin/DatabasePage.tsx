import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useDatabaseHosts } from '../../hooks/useAdmin';

function DatabasePage() {
  const [dbHostId, setDbHostId] = useState<string | null>(null);
  const [dbName, setDbName] = useState('');
  const [dbHost, setDbHost] = useState('');
  const [dbPort, setDbPort] = useState('3306');
  const [dbUsername, setDbUsername] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const queryClient = useQueryClient();
  const { data: databaseHosts = [], isLoading } = useDatabaseHosts();

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
        <h1 className="text-2xl font-semibold text-slate-50">Database</h1>
        <p className="text-sm text-slate-400">Manage database hosts for server provisioning.</p>
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

export default DatabasePage;
