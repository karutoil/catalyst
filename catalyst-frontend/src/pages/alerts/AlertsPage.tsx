import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import EmptyState from '../../components/shared/EmptyState';
import { alertsApi } from '../../services/api/alerts';
import { useNodes } from '../../hooks/useNodes';
import { useServers } from '../../hooks/useServers';
import type { Alert, AlertRule, AlertSeverity, AlertType } from '../../types/alert';
import { notifyError, notifySuccess } from '../../utils/notify';

function AlertsPage() {
  const queryClient = useQueryClient();
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [filterResolved, setFilterResolved] = useState<'false' | 'true' | 'all'>('false');
  const [ruleName, setRuleName] = useState('');
  const [ruleDescription, setRuleDescription] = useState('');
  const [ruleType, setRuleType] = useState<AlertType>('resource_threshold');
  const [ruleTarget, setRuleTarget] = useState<'global' | 'server' | 'node'>('global');
  const [ruleTargetId, setRuleTargetId] = useState('');
  const [cpuThreshold, setCpuThreshold] = useState('85');
  const [memoryThreshold, setMemoryThreshold] = useState('90');
  const [diskThreshold, setDiskThreshold] = useState('90');
  const [offlineThreshold, setOfflineThreshold] = useState('5');
  const [webhookTargets, setWebhookTargets] = useState<string[]>(['']);
  const [emailTargets, setEmailTargets] = useState<string[]>(['']);
  const [notifyOwner, setNotifyOwner] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState('5');

  const resetRuleForm = () => {
    setRuleName('');
    setRuleDescription('');
    setRuleType('resource_threshold');
    setRuleTarget('global');
    setRuleTargetId('');
    setCpuThreshold('85');
    setMemoryThreshold('90');
    setDiskThreshold('90');
    setOfflineThreshold('5');
    setWebhookTargets(['']);
    setEmailTargets(['']);
    setNotifyOwner(false);
    setCooldownMinutes('5');
  };

  const { data: alertData, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', filterResolved],
    queryFn: () =>
      alertsApi.list({
        resolved: filterResolved === 'all' ? undefined : filterResolved === 'true',
      }),
  });
  const { data: alertStats } = useQuery({
    queryKey: ['alerts-stats'],
    queryFn: alertsApi.stats,
  });
  const { data: alertRules = [] } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: () => alertsApi.listRules(),
  });
  const { data: nodes = [] } = useNodes();
  const { data: serversData = [] } = useServers();

  const alerts = alertData?.alerts ?? [];
  const hasAlerts = alerts.length > 0;

  const ruleTypeOptions: Array<{ value: AlertType; label: string }> = [
    { value: 'resource_threshold', label: 'Resource threshold' },
    { value: 'node_offline', label: 'Node offline' },
    { value: 'server_crashed', label: 'Server crashed' },
  ];

  const targetOptions = useMemo(() => {
    if (ruleTarget === 'server') {
      return serversData.map((server) => ({ id: server.id, label: server.name }));
    }
    if (ruleTarget === 'node') {
      return nodes.map((node) => ({ id: node.id, label: node.name }));
    }
    return [];
  }, [nodes, ruleTarget, serversData]);

  const selectedTargetLabel = targetOptions.find((option) => option.id === ruleTargetId)?.label;

  const updateTargetValue = (values: string[], index: number, value: string) =>
    values.map((entry, currentIndex) => (currentIndex === index ? value : entry));

  const createRuleMutation = useMutation({
    mutationFn: () => {
      const conditions: Record<string, number> = {};
      if (ruleType === 'resource_threshold') {
        if (cpuThreshold) conditions.cpuThreshold = Number(cpuThreshold);
        if (memoryThreshold) conditions.memoryThreshold = Number(memoryThreshold);
        if (diskThreshold) conditions.diskThreshold = Number(diskThreshold);
      }
      if (ruleType === 'node_offline') {
        conditions.offlineThreshold = Number(offlineThreshold);
      }
      const actions: Record<string, unknown> = {
        webhooks: webhookTargets.map((entry) => entry.trim()).filter(Boolean),
        emails: emailTargets.map((entry) => entry.trim()).filter(Boolean),
        notifyOwner,
        cooldownMinutes: Number(cooldownMinutes),
      };
      return alertsApi.createRule({
        name: ruleName.trim(),
        description: ruleDescription.trim() || undefined,
        type: ruleType,
        target: ruleTarget,
        targetId: ruleTarget === 'global' ? null : ruleTargetId || null,
        conditions,
        actions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      notifySuccess('Alert rule created');
      setShowRuleModal(false);
      resetRuleForm();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create alert rule';
      notifyError(message);
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: (payload: {
      rule: AlertRule;
      updates: Partial<{
        name: string;
        description?: string;
        conditions: Record<string, number>;
        actions: Record<string, unknown>;
        enabled: boolean;
      }>;
    }) => alertsApi.updateRule(payload.rule.id, payload.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      notifySuccess('Alert rule updated');
      setShowRuleModal(false);
      setEditingRule(null);
      resetRuleForm();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update alert rule';
      notifyError(message);
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) => alertsApi.deleteRule(ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      notifySuccess('Alert rule deleted');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete alert rule';
      notifyError(message);
    },
  });

  const resolveAlertMutation = useMutation({
    mutationFn: (alertId: string) => alertsApi.resolve(alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alerts-stats'] });
      notifySuccess('Alert resolved');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to resolve alert';
      notifyError(message);
    },
  });

  const bulkResolveMutation = useMutation({
    mutationFn: (alertIds: string[]) => alertsApi.bulkResolve(alertIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alerts-stats'] });
      notifySuccess('Alerts resolved');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to resolve alerts';
      notifyError(message);
    },
  });

  const unresolvedAlertIds = alerts.filter((alert) => !alert.resolved).map((alert) => alert.id);
  const canBulkResolve = unresolvedAlertIds.length > 0 && !bulkResolveMutation.isPending;

  const formatSeverity = (severity: AlertSeverity) =>
    severity === 'critical' ? 'text-rose-300' : severity === 'warning' ? 'text-amber-300' : 'text-emerald-300';
  const formatSeverityBadge = (severity: AlertSeverity) =>
    severity === 'critical'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
      : severity === 'warning'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';

  const emptyState = (
    <EmptyState
      title="All clear"
      description="No active alerts. Create rules to get notified when something breaks."
      action={
        <button
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500"
          onClick={() => setShowRuleModal(true)}
        >
          Create alert rule
        </button>
      }
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Alerts</h1>
          <p className="text-sm text-slate-400">Monitor incidents and resolve alerts in real time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
            value={filterResolved}
            onChange={(event) => setFilterResolved(event.target.value as 'false' | 'true' | 'all')}
          >
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
            <option value="all">All</option>
          </select>
          <button
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-60"
            onClick={() => bulkResolveMutation.mutate(unresolvedAlertIds)}
            disabled={!canBulkResolve}
          >
            Resolve all
          </button>
          <button
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-sky-500"
            onClick={() => setShowRuleModal(true)}
          >
            Create Rule
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs text-slate-400">Active alerts</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">{alertStats?.unresolved ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs text-slate-400">Total alerts</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">{alertStats?.total ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs text-slate-400">Critical alerts</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">
            {alertStats?.bySeverity?.critical ?? 0}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Alert rules</div>
            <div className="text-xs text-slate-400">Manage thresholds and notification targets.</div>
          </div>
        </div>
        <div className="mt-4 space-y-3 text-xs text-slate-300">
          {alertRules.length ? (
            alertRules.map((rule) => (
              <div
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-100">{rule.name}</div>
                  <div className="text-xs text-slate-400">
                    {rule.description || rule.type.replace('_', ' ')} · {rule.target}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide ${
                      rule.enabled
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-slate-700 bg-slate-800 text-slate-300'
                    }`}
                  >
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-60"
                    onClick={() => updateRuleMutation.mutate({ rule, updates: { enabled: !rule.enabled } })}
                    disabled={updateRuleMutation.isPending}
                  >
                    {rule.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:border-slate-500"
                    onClick={() => {
                      setEditingRule(rule);
                      setShowRuleModal(true);
                      setRuleName(rule.name);
                      setRuleDescription(rule.description ?? '');
                      setRuleType(rule.type);
                      setRuleTarget(rule.target);
                      setRuleTargetId(rule.targetId ?? '');
                      const conditions = rule.conditions as Record<string, number>;
                      setCpuThreshold(String(conditions.cpuThreshold ?? ''));
                      setMemoryThreshold(String(conditions.memoryThreshold ?? ''));
                      setDiskThreshold(String(conditions.diskThreshold ?? ''));
                      setOfflineThreshold(String(conditions.offlineThreshold ?? ''));
                      const actions = rule.actions as Record<string, unknown>;
                      const webhooks = (actions.webhooks as string[] | undefined) ?? [];
                      const emails = (actions.emails as string[] | undefined) ?? [];
                      setWebhookTargets(webhooks.length ? webhooks : ['']);
                      setEmailTargets(emails.length ? emails : ['']);
                      setNotifyOwner(Boolean(actions.notifyOwner));
                      setCooldownMinutes(String((actions.cooldownMinutes as number | undefined) ?? 5));
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-rose-700 px-2 py-1 text-[10px] font-semibold text-rose-200 hover:border-rose-500 disabled:opacity-60"
                    onClick={() => deleteRuleMutation.mutate(rule.id)}
                    disabled={deleteRuleMutation.isPending}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-6 py-6 text-center text-xs text-slate-400">
              No alert rules created yet.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">Alert history</div>
            <div className="text-xs text-slate-400">Latest triggered alerts and delivery status.</div>
          </div>
        </div>
        <div className="mt-4 space-y-3 text-xs text-slate-300">
          {alertsLoading ? (
            <div className="text-xs text-slate-400">Loading alerts...</div>
          ) : hasAlerts ? (
            alerts.map((alert) => (
              <div key={alert.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 text-[10px] uppercase ${formatSeverityBadge(alert.severity)}`}>
                        {alert.severity}
                      </span>
                      <span className="text-sm font-semibold text-slate-100">{alert.title}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">{alert.message}</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                      <span>{new Date(alert.createdAt).toLocaleString()}</span>
                      {alert.server?.name ? <span>Server: {alert.server.name}</span> : null}
                      {alert.node?.name ? <span>Node: {alert.node.name}</span> : null}
                      {alert.rule?.name ? <span>Rule: {alert.rule.name}</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {alert.resolved ? (
                      <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase text-slate-300">
                        Resolved
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-md border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-60"
                        onClick={() => resolveAlertMutation.mutate(alert.id)}
                        disabled={resolveAlertMutation.isPending}
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
                {alert.deliveries?.length ? (
                  <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-slate-300 sm:grid-cols-2">
                    {alert.deliveries.map((delivery) => (
                      <div
                        key={delivery.id}
                        className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">{delivery.channel}</span>
                          <span
                            className={
                              delivery.status === 'failed'
                                ? 'text-rose-300'
                                : delivery.status === 'sent'
                                  ? 'text-emerald-300'
                                  : 'text-slate-300'
                            }
                          >
                            {delivery.status}
                          </span>
                        </div>
                        <div className="mt-1 text-slate-200">{delivery.target}</div>
                        {delivery.lastError ? (
                          <div className="mt-1 text-[10px] text-rose-300">{delivery.lastError}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            emptyState
          )}
        </div>
      </div>

      {showRuleModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-100">
                {editingRule ? 'Edit alert rule' : 'Create alert rule'}
              </h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => {
                  setShowRuleModal(false);
                  setEditingRule(null);
                  resetRuleForm();
                }}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-6 py-4 text-sm text-slate-100">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Rule name</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    value={ruleName}
                    onChange={(event) => setRuleName(event.target.value)}
                    placeholder="High CPU usage"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Description</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    value={ruleDescription}
                    onChange={(event) => setRuleDescription(event.target.value)}
                    placeholder="Notify when CPU stays high"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Rule type</span>
                  <select
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    value={ruleType}
                    onChange={(event) => setRuleType(event.target.value as AlertType)}
                  >
                    {ruleTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Target</span>
                  <select
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    value={ruleTarget}
                    onChange={(event) => setRuleTarget(event.target.value as 'global' | 'server' | 'node')}
                  >
                    <option value="global">Global</option>
                    <option value="server">Server</option>
                    <option value="node">Node</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Target ID</span>
                  <select
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    value={ruleTargetId}
                    onChange={(event) => setRuleTargetId(event.target.value)}
                    disabled={ruleTarget === 'global'}
                  >
                    <option value="">
                      {ruleTarget === 'global'
                        ? 'Not required'
                        : selectedTargetLabel || 'Select target'}
                    </option>
                    {targetOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {ruleType === 'resource_threshold' ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-300">CPU threshold (%)</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      value={cpuThreshold}
                      onChange={(event) => setCpuThreshold(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-300">Memory threshold (%)</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      value={memoryThreshold}
                      onChange={(event) => setMemoryThreshold(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-300">Disk threshold (%)</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      value={diskThreshold}
                      onChange={(event) => setDiskThreshold(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              {ruleType === 'node_offline' ? (
                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Offline threshold (minutes)</span>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    value={offlineThreshold}
                    onChange={(event) => setOfflineThreshold(event.target.value)}
                  />
                </label>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Webhook URLs</span>
                    <button
                      type="button"
                      className="rounded-md border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:border-slate-500"
                      onClick={() => setWebhookTargets((current) => [...current, ''])}
                    >
                      + Add
                    </button>
                  </div>
                  {webhookTargets.map((value, index) => (
                    <div key={`webhook-${index}`} className="flex items-center gap-2">
                      <input
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                        value={value}
                        onChange={(event) =>
                          setWebhookTargets((current) => updateTargetValue(current, index, event.target.value))
                        }
                        placeholder="https://discord.com/api/webhooks/..."
                      />
                      {webhookTargets.length > 1 ? (
                        <button
                          type="button"
                          className="rounded-md border border-rose-700 px-2 py-1 text-[10px] font-semibold text-rose-200 hover:border-rose-500"
                          onClick={() =>
                            setWebhookTargets((current) => current.filter((_, currentIndex) => currentIndex !== index))
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Email recipients</span>
                    <button
                      type="button"
                      className="rounded-md border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:border-slate-500"
                      onClick={() => setEmailTargets((current) => [...current, ''])}
                    >
                      + Add
                    </button>
                  </div>
                  {emailTargets.map((value, index) => (
                    <div key={`email-${index}`} className="flex items-center gap-2">
                      <input
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                        value={value}
                        onChange={(event) =>
                          setEmailTargets((current) => updateTargetValue(current, index, event.target.value))
                        }
                        placeholder="alerts@example.com"
                      />
                      {emailTargets.length > 1 ? (
                        <button
                          type="button"
                          className="rounded-md border border-rose-700 px-2 py-1 text-[10px] font-semibold text-rose-200 hover:border-rose-500"
                          onClick={() =>
                            setEmailTargets((current) => current.filter((_, currentIndex) => currentIndex !== index))
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                    checked={notifyOwner}
                    onChange={(event) => setNotifyOwner(event.target.checked)}
                  />
                  Notify server owner
                </label>
                <label className="block space-y-1 md:col-span-2">
                  <span className="text-xs text-slate-300">Cooldown (minutes)</span>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    value={cooldownMinutes}
                    onChange={(event) => setCooldownMinutes(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 px-6 py-4 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => {
                  setShowRuleModal(false);
                  setEditingRule(null);
                  resetRuleForm();
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                onClick={() => {
                  if (editingRule) {
                    const conditions: Record<string, number> = {};
                    if (ruleType === 'resource_threshold') {
                      if (cpuThreshold) conditions.cpuThreshold = Number(cpuThreshold);
                      if (memoryThreshold) conditions.memoryThreshold = Number(memoryThreshold);
                      if (diskThreshold) conditions.diskThreshold = Number(diskThreshold);
                    }
                    if (ruleType === 'node_offline') {
                      conditions.offlineThreshold = Number(offlineThreshold);
                    }
                    const actions: Record<string, unknown> = {
                      webhooks: webhookTargets.map((entry) => entry.trim()).filter(Boolean),
                      emails: emailTargets.map((entry) => entry.trim()).filter(Boolean),
                      notifyOwner,
                      cooldownMinutes: Number(cooldownMinutes),
                    };
                    updateRuleMutation.mutate({
                      rule: editingRule,
                      updates: {
                        name: ruleName.trim(),
                        description: ruleDescription.trim() || undefined,
                        conditions,
                        actions,
                        enabled: editingRule.enabled,
                      },
                    });
                    return;
                  }
                  createRuleMutation.mutate();
                }}
                disabled={
                  !ruleName.trim() ||
                  (ruleTarget !== 'global' && !ruleTargetId) ||
                  createRuleMutation.isPending ||
                  updateRuleMutation.isPending
                }
              >
                {editingRule
                  ? updateRuleMutation.isPending
                    ? 'Saving...'
                    : 'Save changes'
                  : createRuleMutation.isPending
                    ? 'Creating...'
                    : 'Create rule'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AlertsPage;
