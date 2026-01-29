import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import { useAuthLockouts, useSecuritySettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

function SecurityPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSecuritySettings();
  const [authRateLimitMax, setAuthRateLimitMax] = useState('5');
  const [fileRateLimitMax, setFileRateLimitMax] = useState('30');
  const [consoleRateLimitMax, setConsoleRateLimitMax] = useState('60');
  const [lockoutMaxAttempts, setLockoutMaxAttempts] = useState('5');
  const [lockoutWindowMinutes, setLockoutWindowMinutes] = useState('15');
  const [lockoutDurationMinutes, setLockoutDurationMinutes] = useState('15');
  const [auditRetentionDays, setAuditRetentionDays] = useState('90');
  const [search, setSearch] = useState('');
  const [lockoutPage, setLockoutPage] = useState(1);
  const lockoutPageSize = 20;
  const { data: lockoutResponse, isLoading: lockoutsLoading } = useAuthLockouts({
    page: lockoutPage,
    limit: lockoutPageSize,
    search: search.trim() || undefined,
  });

  useEffect(() => {
    if (!settings) return;
    setAuthRateLimitMax(String(settings.authRateLimitMax));
    setFileRateLimitMax(String(settings.fileRateLimitMax));
    setConsoleRateLimitMax(String(settings.consoleRateLimitMax));
    setLockoutMaxAttempts(String(settings.lockoutMaxAttempts));
    setLockoutWindowMinutes(String(settings.lockoutWindowMinutes));
    setLockoutDurationMinutes(String(settings.lockoutDurationMinutes));
    setAuditRetentionDays(String(settings.auditRetentionDays));
  }, [settings]);

  const canSubmit = useMemo(
    () =>
      Number(authRateLimitMax) > 0 &&
      Number(fileRateLimitMax) > 0 &&
      Number(consoleRateLimitMax) > 0 &&
      Number(lockoutMaxAttempts) > 0 &&
      Number(lockoutWindowMinutes) > 0 &&
      Number(lockoutDurationMinutes) > 0 &&
      Number(auditRetentionDays) > 0,
    [
      authRateLimitMax,
      fileRateLimitMax,
      consoleRateLimitMax,
      lockoutMaxAttempts,
      lockoutWindowMinutes,
      lockoutDurationMinutes,
      auditRetentionDays,
    ],
  );

  const updateMutation = useMutation({
    mutationFn: () =>
      adminApi.updateSecuritySettings({
        authRateLimitMax: Number(authRateLimitMax),
        fileRateLimitMax: Number(fileRateLimitMax),
        consoleRateLimitMax: Number(consoleRateLimitMax),
        lockoutMaxAttempts: Number(lockoutMaxAttempts),
        lockoutWindowMinutes: Number(lockoutWindowMinutes),
        lockoutDurationMinutes: Number(lockoutDurationMinutes),
        auditRetentionDays: Number(auditRetentionDays),
      }),
    onSuccess: () => {
      notifySuccess('Security settings updated');
      queryClient.invalidateQueries({ queryKey: ['admin-security-settings'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update security settings';
      notifyError(message);
    },
  });

  const clearMutation = useMutation({
    mutationFn: (lockoutId: string) => adminApi.clearAuthLockout(lockoutId),
    onSuccess: () => {
      notifySuccess('Lockout cleared');
      queryClient.invalidateQueries({ queryKey: ['admin-auth-lockouts'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to clear lockout';
      notifyError(message);
    },
  });

  const lockouts = lockoutResponse?.lockouts ?? [];
  const lockoutPagination = lockoutResponse?.pagination;

  return (
    <div className="space-y-4">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-semibold text-slate-50">Security</h1>
        <p className="text-sm text-slate-400">
          Configure rate limits, lockout policy, and audit retention.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Security settings</h2>
            <p className="text-xs text-slate-400">
              Rate limits apply per minute. Lockouts apply per email + IP.
            </p>
          </div>
          <button
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
            onClick={() => updateMutation.mutate()}
            disabled={!canSubmit || updateMutation.isPending}
          >
            Save settings
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-300">
            Auth requests / min
            <input
              value={authRateLimitMax}
              onChange={(event) => setAuthRateLimitMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-slate-300">
            File ops / min
            <input
              value={fileRateLimitMax}
              onChange={(event) => setFileRateLimitMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Console input / min
            <input
              value={consoleRateLimitMax}
              onChange={(event) => setConsoleRateLimitMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Lockout attempts
            <input
              value={lockoutMaxAttempts}
              onChange={(event) => setLockoutMaxAttempts(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Lockout window (min)
            <input
              value={lockoutWindowMinutes}
              onChange={(event) => setLockoutWindowMinutes(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Lockout duration (min)
            <input
              value={lockoutDurationMinutes}
              onChange={(event) => setLockoutDurationMinutes(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-slate-300">
            Audit retention (days)
            <input
              value={auditRetentionDays}
              onChange={(event) => setAuditRetentionDays(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Auth lockouts</h2>
            <p className="text-xs text-slate-400">Track recent lockout entries.</p>
          </div>
          <label className="text-xs text-slate-300">
            Search
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLockoutPage(1);
              }}
              placeholder="Search lockouts"
              className="mt-1 w-56 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
        </div>

        {lockoutsLoading ? (
          <div className="px-6 py-6 text-sm text-slate-300">Loading lockouts...</div>
        ) : lockouts.length ? (
          <div>
            <div className="divide-y divide-slate-800">
              {lockouts.map((lockout) => (
                <div key={lockout.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 text-sm">
                  <div>
                    <div className="text-slate-100">{lockout.email}</div>
                    <div className="text-xs text-slate-500">{lockout.ipAddress}</div>
                    <div className="text-xs text-slate-500">
                      Attempts: {lockout.failureCount} · Last failed:{' '}
                      {new Date(lockout.lastFailedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    {lockout.lockedUntil
                      ? `Locked until ${new Date(lockout.lockedUntil).toLocaleString()}`
                      : 'Active'}
                  </div>
                  <button
                    className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-60"
                    onClick={() => clearMutation.mutate(lockout.id)}
                    disabled={clearMutation.isPending}
                  >
                    Clear
                  </button>
                </div>
              ))}
            </div>
            {lockoutPagination ? (
              <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3 text-xs text-slate-400">
                <span>
                  Page {lockoutPagination.page} of {lockoutPagination.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
                    onClick={() => setLockoutPage((prev) => Math.max(1, prev - 1))}
                    disabled={lockoutPage <= 1}
                  >
                    Previous
                  </button>
                  <button
                    className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
                    onClick={() =>
                      setLockoutPage((prev) =>
                        lockoutPagination.page < lockoutPagination.totalPages ? prev + 1 : prev,
                      )
                    }
                    disabled={lockoutPagination.page >= lockoutPagination.totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No lockouts" description="Failed login attempts will show here." />
        )}
      </div>
    </div>
  );
}

export default SecurityPage;
