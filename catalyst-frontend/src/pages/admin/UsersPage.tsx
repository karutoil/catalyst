import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import { useAdminRoles, useAdminServers, useAdminUsers } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

const pageSize = 20;

function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [serverIds, setServerIds] = useState<string[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [roleSearch, setRoleSearch] = useState('');
  const [serverSearch, setServerSearch] = useState('');
  const [editRoleSearch, setEditRoleSearch] = useState('');
  const [editServerSearch, setEditServerSearch] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const editingRequestRef = useRef(0);
  const [editEmail, setEditEmail] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [editServerIds, setEditServerIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminUsers({ page, limit: pageSize, search: search.trim() || undefined });
  const { data: roles = [] } = useAdminRoles();
  const { data: serversResponse } = useAdminServers({ page: 1, limit: 200 });
  const servers = serversResponse?.servers ?? [];
  const serverOptions = useMemo(
    () => servers.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
  );
  const filteredRoles = useMemo(
    () =>
      roles.filter((role) => role.name.toLowerCase().includes(roleSearch.trim().toLowerCase())),
    [roles, roleSearch],
  );
  const filteredServers = useMemo(
    () =>
      serverOptions.filter(
        (server) =>
          server.name.toLowerCase().includes(serverSearch.trim().toLowerCase()) ||
          server.id.toLowerCase().includes(serverSearch.trim().toLowerCase()),
      ),
    [serverOptions, serverSearch],
  );
  const filteredEditRoles = useMemo(
    () =>
      roles.filter((role) =>
        role.name.toLowerCase().includes(editRoleSearch.trim().toLowerCase()),
      ),
    [roles, editRoleSearch],
  );
  const filteredEditServers = useMemo(
    () =>
      serverOptions.filter(
        (server) =>
          server.name.toLowerCase().includes(editServerSearch.trim().toLowerCase()) ||
          server.id.toLowerCase().includes(editServerSearch.trim().toLowerCase()),
      ),
    [serverOptions, editServerSearch],
  );

  const canSubmit = useMemo(
    () => email.trim() && username.trim() && password.trim().length >= 8,
    [email, username, password],
  );
  const canSubmitEdit = useMemo(
    () => editEmail.trim() && editUsername.trim() && (!editPassword || editPassword.length >= 8),
    [editEmail, editUsername, editPassword],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        email: email.trim(),
        username: username.trim(),
        password: password.trim(),
        roleIds,
        serverIds,
      }),
    onSuccess: () => {
      notifySuccess('User created');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setEmail('');
      setUsername('');
      setPassword('');
      setRoleIds([]);
      setServerIds([]);
      setRoleSearch('');
      setServerSearch('');
      setIsCreateOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create user';
      notifyError(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (userId: string) =>
      adminApi.updateUser(userId, {
        email: editEmail.trim(),
        username: editUsername.trim(),
        password: editPassword.trim() ? editPassword.trim() : undefined,
        roleIds: editRoleIds,
        serverIds: editServerIds,
      }),
    onSuccess: () => {
      notifySuccess('User updated');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setEditingUserId(null);
      setEditRoleSearch('');
      setEditServerSearch('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update user';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: () => {
      notifySuccess('User deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete user';
      notifyError(message);
    },
  });

  const users = data?.users ?? [];
  const pagination = data?.pagination;

  const toggleItem = (items: string[], value: string) =>
    items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

  return (
    <div className="space-y-4">
      <AdminTabs />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">User Management</h1>
          <p className="text-sm text-slate-400">Create and manage administrator accounts.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search users"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none sm:w-56"
          />
          <button
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500"
            onClick={() => {
              setIsCreateOpen(true);
              setRoleSearch('');
              setServerSearch('');
            }}
          >
            Create user
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
          Loading users...
        </div>
      ) : users.length ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60">
          <div className="grid grid-cols-12 gap-3 border-b border-slate-800 px-4 py-3 text-xs uppercase text-slate-500">
            <div className="col-span-4">User</div>
            <div className="col-span-3">Email</div>
            <div className="col-span-3">Roles</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          <div className="divide-y divide-slate-800">
            {users.map((user) => (
              <div key={user.id} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm text-slate-200">
                <div className="col-span-4">
                  <div className="font-semibold text-slate-100">{user.username}</div>
                  <div className="text-xs text-slate-500">Created {new Date(user.createdAt).toLocaleDateString()}</div>
                </div>
                <div className="col-span-3 text-slate-300">{user.email}</div>
                <div className="col-span-3 flex flex-wrap gap-2">
                  {user.roles.length ? (
                    user.roles.map((role) => (
                      <span
                        key={role.id}
                        className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300"
                      >
                        {role.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">No roles</span>
                  )}
                </div>
                <div className="col-span-2 flex justify-end">
                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
                      onClick={() => {
                        const nextId = user.id;
                        const requestId = editingRequestRef.current + 1;
                        editingRequestRef.current = requestId;
                        setEditingUserId(nextId);
                        setEditEmail(user.email);
                        setEditUsername(user.username);
                        setEditPassword('');
                        setEditRoleIds(user.roles.map((role) => role.id));
                        setEditServerIds([]);
                        setEditRoleSearch('');
                        setEditServerSearch('');
                        adminApi
                          .getUserServers(nextId)
                          .then((serverSelection) => {
                            if (editingRequestRef.current === requestId) {
                              setEditServerIds(serverSelection);
                            }
                          })
                          .catch(() => {
                            notifyError('Failed to load user servers');
                          });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-md border border-rose-700 px-2 py-1 text-xs text-rose-200 hover:border-rose-500"
                      onClick={() => deleteMutation.mutate(user.id)}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </button>
                  </div>
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
          title={search.trim() ? 'No users found' : 'No users'}
          description={
            search.trim()
              ? 'Try a different username or email.'
              : 'Create a user account to grant dashboard access.'
          }
        />
      )}
      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Create user</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => setIsCreateOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-6 py-4 text-sm text-slate-100">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="text-xs text-slate-300">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="user@example.com"
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  Username
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="username"
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  Password (min 8 chars)
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="********"
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </label>
              </div>
              <div className="text-xs text-slate-300">
                <div className="mb-1 text-slate-400">Roles</div>
                <input
                  value={editRoleSearch}
                  onChange={(event) => setEditRoleSearch(event.target.value)}
                  placeholder="Search roles"
                  className="mb-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
                <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                  {filteredEditRoles.map((role) => (
                    <label
                      key={role.id}
                      className="flex items-center gap-2 rounded-md border border-slate-800 px-2 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={roleIds.includes(role.id)}
                        onChange={() => setRoleIds((prev) => toggleItem(prev, role.id))}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-500"
                      />
                      <span className="text-xs text-slate-200">{role.name}</span>
                    </label>
                  ))}
                  {!filteredRoles.length ? (
                    <span className="text-xs text-slate-500">No roles match</span>
                  ) : null}
                </div>
              </div>
              <div className="text-xs text-slate-300">
                <div className="mb-1 text-slate-400">Server access</div>
                <input
                  value={editServerSearch}
                  onChange={(event) => setEditServerSearch(event.target.value)}
                  placeholder="Search servers"
                  className="mb-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
                <div className="flex max-h-36 flex-col gap-2 overflow-y-auto">
                  {filteredEditServers.map((server) => (
                    <label
                      key={server.id}
                      className="flex items-center gap-2 rounded-md border border-slate-800 px-2 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={serverIds.includes(server.id)}
                        onChange={() => setServerIds((prev) => toggleItem(prev, server.id))}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-500"
                      />
                      <span className="text-xs text-slate-200">{server.name}</span>
                      <span className="text-[10px] text-slate-500">({server.id})</span>
                    </label>
                  ))}
                  {!filteredServers.length ? (
                    <span className="text-xs text-slate-500">No servers match</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 px-6 py-4 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => {
                  setIsCreateOpen(false);
                  setRoleSearch('');
                  setServerSearch('');
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                disabled={!canSubmit || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Create user
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {editingUserId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Edit user</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => setEditingUserId(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-6 py-4 text-sm text-slate-100">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="text-xs text-slate-300">
                  Email
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  Username
                  <input
                    value={editUsername}
                    onChange={(event) => setEditUsername(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  Password (leave blank to keep)
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(event) => setEditPassword(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </label>
              </div>
              <div className="text-xs text-slate-300">
                <div className="mb-1 text-slate-400">Roles</div>
                <input
                  value={roleSearch}
                  onChange={(event) => setRoleSearch(event.target.value)}
                  placeholder="Search roles"
                  className="mb-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
                <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                  {filteredRoles.map((role) => (
                    <label
                      key={role.id}
                      className="flex items-center gap-2 rounded-md border border-slate-800 px-2 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={editRoleIds.includes(role.id)}
                        onChange={() => setEditRoleIds((prev) => toggleItem(prev, role.id))}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-500"
                      />
                      <span className="text-xs text-slate-200">{role.name}</span>
                    </label>
                  ))}
                  {!filteredRoles.length ? (
                    <span className="text-xs text-slate-500">No roles match</span>
                  ) : null}
                </div>
              </div>
              <div className="text-xs text-slate-300">
                <div className="mb-1 text-slate-400">Server access</div>
                <input
                  value={serverSearch}
                  onChange={(event) => setServerSearch(event.target.value)}
                  placeholder="Search servers"
                  className="mb-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
                <div className="flex max-h-36 flex-col gap-2 overflow-y-auto">
                  {filteredServers.map((server) => (
                    <label
                      key={server.id}
                      className="flex items-center gap-2 rounded-md border border-slate-800 px-2 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={editServerIds.includes(server.id)}
                        onChange={() => setEditServerIds((prev) => toggleItem(prev, server.id))}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-500"
                      />
                      <span className="text-xs text-slate-200">{server.name}</span>
                      <span className="text-[10px] text-slate-500">({server.id})</span>
                    </label>
                  ))}
                  {!filteredServers.length ? (
                    <span className="text-xs text-slate-500">No servers match</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 px-6 py-4 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => {
                  setEditingUserId(null);
                  setEditRoleSearch('');
                  setEditServerSearch('');
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                onClick={() => editingUserId && updateMutation.mutate(editingUserId)}
                disabled={!canSubmitEdit || updateMutation.isPending}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default UsersPage;
