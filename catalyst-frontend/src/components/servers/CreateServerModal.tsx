import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { useTemplates } from '../../hooks/useTemplates';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Template } from '../../types/template';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';

function CreateServerModal() {
  const { user } = useAuthStore();
  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [description, setDescription] = useState('');
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [disk, setDisk] = useState('10240');
  const [backupAllocationMb, setBackupAllocationMb] = useState('');
  const [databaseAllocation, setDatabaseAllocation] = useState('');
  const [port, setPort] = useState('25565');
  const [portBindings, setPortBindings] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [imageVariant, setImageVariant] = useState('');
  const [networkMode, setNetworkMode] = useState('mc-lan-static');
  const [customNetworkMode, setCustomNetworkMode] = useState('');
  const [primaryIp, setPrimaryIp] = useState('');
  const [allocationId, setAllocationId] = useState('');
  const [availableAllocations, setAvailableAllocations] = useState<
    Array<{ id: string; ip: string; port: number; alias?: string | null }>
  >([]);
  const [allocLoadError, setAllocLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<'details' | 'resources' | 'build' | 'startup'>('details');
  const navigate = useNavigate();

  const { data: templates = [] } = useTemplates();
  const { data: nodes = [] } = useNodes();
  const [availableIps, setAvailableIps] = useState<string[]>([]);
  const [ipLoadError, setIpLoadError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Get selected template
  const selectedTemplate = useMemo(() => templates.find(t => t.id === templateId), [templates, templateId]);

  // Filter out SERVER_DIR from variables
  const templateVariables = useMemo(() => {
    if (!selectedTemplate?.variables) return [];
    return selectedTemplate.variables.filter(v => v.name !== 'SERVER_DIR');
  }, [selectedTemplate]);

  const selectedNode = useMemo(() => nodes.find((node) => node.id === nodeId), [nodes, nodeId]);
  const locationId = selectedNode?.locationId || nodes[0]?.locationId || '';

  useEffect(() => {
    setPrimaryIp('');
    let active = true;
    if (!nodeId || networkMode === 'bridge' || networkMode === 'host' || networkMode === 'custom') {
      setAvailableIps([]);
      setIpLoadError(null);
      return;
    }

    setIpLoadError(null);
    nodesApi
      .availableIps(nodeId, networkMode, 200)
      .then((ips) => {
        if (!active) return;
        setAvailableIps(ips);
      })
      .catch((error: any) => {
        if (!active) return;
        const message = error?.response?.data?.error || 'Unable to load IP pool';
        setAvailableIps([]);
        setIpLoadError(message);
      });

    return () => {
      active = false;
    };
  }, [nodeId, networkMode]);

  useEffect(() => {
    if (!nodeId || networkMode !== 'custom') {
      return;
    }
    const networkName = customNetworkMode.trim();
    if (!networkName) {
      setAvailableIps([]);
      setIpLoadError(null);
      return;
    }
    setPrimaryIp('');
    let active = true;
    setIpLoadError(null);
    nodesApi
      .availableIps(nodeId, networkName, 200)
      .then((ips) => {
        if (!active) return;
        setAvailableIps(ips);
      })
      .catch((error: any) => {
        if (!active) return;
        const message = error?.response?.data?.error || 'Unable to load IP pool';
        setAvailableIps([]);
        setIpLoadError(message);
      });

    return () => {
      active = false;
    };
  }, [nodeId, networkMode, customNetworkMode]);

  useEffect(() => {
    setAllocationId('');
    let active = true;
    if (!nodeId || networkMode !== 'bridge') {
      setAvailableAllocations([]);
      setAllocLoadError(null);
      return () => {
        active = false;
      };
    }
    setAllocLoadError(null);
    nodesApi
      .allocations(nodeId)
      .then((allocations) => {
        if (!active) return;
        setAvailableAllocations(
          allocations
            .filter((allocation) => !allocation.serverId)
            .map((allocation) => ({
              id: allocation.id,
              ip: allocation.ip,
              port: allocation.port,
              alias: allocation.alias,
            })),
        );
      })
      .catch((error: any) => {
        if (!active) return;
        const message = error?.response?.data?.error || 'Unable to load allocations';
        setAvailableAllocations([]);
        setAllocLoadError(message);
      });

    return () => {
      active = false;
    };
  }, [nodeId, networkMode]);

  const mutation = useMutation({
    mutationFn: async () => {
      // Create server first
      const normalizedBindings = portBindings
        .map(binding => binding.trim())
        .filter(Boolean)
        .reduce<Record<number, number>>((acc, binding) => {
          const [containerPortRaw, hostPortRaw] = binding.split(':');
          const containerPort = Number(containerPortRaw);
          const hostPort = Number(hostPortRaw ?? containerPortRaw);
          if (
            Number.isFinite(containerPort) &&
            Number.isFinite(hostPort) &&
            containerPort > 0 &&
            containerPort <= 65535 &&
            hostPort > 0 &&
            hostPort <= 65535
          ) {
            acc[containerPort] = hostPort;
          }
          return acc;
        }, {});

        const payload: Parameters<typeof serversApi.create>[0] = {
          name,
          description: description.trim() || undefined,
          templateId,
          nodeId,
        locationId,
        allocatedMemoryMb: Number(memory),
          allocatedCpuCores: Number(cpu),
          allocatedDiskMb: Number(disk),
          backupAllocationMb:
            backupAllocationMb.trim() === '' ? undefined : Number(backupAllocationMb),
          databaseAllocation:
            databaseAllocation.trim() === '' ? undefined : Number(databaseAllocation),
        primaryPort: Number(port),
        portBindings: Object.keys(normalizedBindings).length ? normalizedBindings : undefined,
        networkMode: networkMode === 'custom' ? customNetworkMode.trim() : networkMode,
        environment: {
          ...environment,
          ...(imageVariant ? { IMAGE_VARIANT: imageVariant } : {}),
        },
      };
      if (networkMode !== 'bridge' && networkMode !== 'host') {
        payload.primaryIp = primaryIp.trim() || null;
      }
      if (networkMode === 'bridge') {
        if (allocationId) {
          payload.allocationId = allocationId;
        }
      }

      const server = await serversApi.create(payload);
      
      // Then trigger installation
      if (server?.id) {
        await serversApi.install(server.id);
      }
      
      return server;
    },
    onSuccess: (server) => {
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'servers',
      });
      notifySuccess('Server created and installation started');
      setOpen(false);
      setName('');
      setDescription('');
      setTemplateId('');
      setNodeId('');
      setEnvironment({});
      setImageVariant('');
      setNetworkMode('mc-lan-static');
      setCustomNetworkMode('');
      setPrimaryIp('');
      setPortBindings([]);
      setBackupAllocationMb('');
      setDatabaseAllocation('');
      setStep('details');
      if (server?.id) {
        navigate(`/servers/${server.id}/console`);
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create server';
      notifyError(message);
    },
  });

  const stepOrder = ['details', 'resources', 'build', 'startup'] as const;
  const stepIndex = stepOrder.indexOf(step);
  const parsedMemory = Number(memory);
  const parsedCpu = Number(cpu);
  const parsedDisk = Number(disk);
  const parsedPort = Number(port);
  const detailsValid = Boolean(name.trim() && templateId && nodeId);
  const resourcesValid =
    Number.isFinite(parsedMemory) &&
    parsedMemory >= 256 &&
    Number.isFinite(parsedCpu) &&
    parsedCpu >= 1 &&
    Number.isFinite(parsedDisk) &&
    parsedDisk >= 1024;
  const buildValid = Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
  const startupValid = !templateVariables.some((variable) => {
    if (!variable.required) return false;
    const value = environment[variable.name];
    return value === undefined || value === null || String(value).trim() === '';
  });
  const stepValidMap = {
    details: detailsValid,
    resources: resourcesValid,
    build: buildValid,
    startup: startupValid,
  } as const;
  const canGoNext = stepValidMap[step];
  const canNavigateTo = (targetIndex: number) =>
    targetIndex <= stepIndex ||
    stepOrder.slice(0, targetIndex).every((key) => stepValidMap[key]);
  const disableSubmit =
    mutation.isPending ||
    !detailsValid ||
    !resourcesValid ||
    !buildValid ||
    !startupValid ||
    (networkMode === 'custom' && !customNetworkMode.trim());

  if (!canCreateServer) {
    return null;
  }
  return (
    <div>
      <button
        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
        onClick={() => {
          setStep('details');
          setOpen(true);
        }}
      >
        New Server
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg max-h-[90vh] rounded-xl border border-slate-200 bg-white shadow-xl flex flex-col dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Create server</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-4 text-sm text-slate-900 dark:text-slate-100">
              <div className="flex gap-4">
                <div className="w-36 shrink-0 space-y-2">
                  {stepOrder.map((key, index) => {
                    const isActive = step === key;
                    const canNavigate = canNavigateTo(index);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!canNavigate}
                        onClick={() => {
                          if (canNavigate) setStep(key);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-all duration-300 ${
                          isActive
                            ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-500/10 dark:text-primary-200'
                            : 'border-slate-200 text-slate-600 hover:border-primary-200 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30'
                        }`}
                      >
                        <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Step {index + 1}
                        </div>
                        <div className="capitalize">
                          {key === 'details'
                            ? 'Details'
                            : key === 'resources'
                              ? 'Resources'
                              : key === 'build'
                                ? 'Build'
                                : 'Startup'}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex-1 space-y-3">
                  {step === 'details' ? (
                    <>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Name</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="minecraft-01"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Description</span>
                        <textarea
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Optional description"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Template</span>
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={templateId}
                          onChange={(e) => {
                            const newTemplateId = e.target.value;
                            setTemplateId(newTemplateId);
                            setImageVariant('');
                            const template = templates.find((t) => t.id === newTemplateId);
                            if (template?.variables) {
                              const defaultEnv: Record<string, string> = {};
                              template.variables
                                .filter((v) => v.name !== 'SERVER_DIR')
                                .forEach((v) => {
                                  defaultEnv[v.name] = v.default;
                                });
                              setEnvironment(defaultEnv);
                            } else {
                              setEnvironment({});
                            }
                          }}
                        >
                          <option value="">Select template</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedTemplate?.images?.length ? (
                        <label className="block space-y-1">
                          <span className="text-slate-600 dark:text-slate-300">Image variant</span>
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                            value={imageVariant}
                            onChange={(e) => setImageVariant(e.target.value)}
                          >
                            <option value="">Use default</option>
                            {selectedTemplate.images.map((option) => (
                              <option key={option.name} value={option.name}>
                                {option.label ?? option.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Node</span>
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={nodeId}
                          onChange={(e) => setNodeId(e.target.value)}
                        >
                          <option value="">Select node</option>
                          {nodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : null}
                  {step === 'resources' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Memory (MB)</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={memory}
                          onChange={(e) => setMemory(e.target.value)}
                          type="number"
                          min={256}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">CPU cores</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={cpu}
                          onChange={(e) => setCpu(e.target.value)}
                          type="number"
                          min={1}
                          step={1}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Disk (MB)</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={disk}
                          onChange={(e) => setDisk(e.target.value)}
                          type="number"
                          min={1024}
                          step={1024}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Backup allocation (MB)</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={backupAllocationMb}
                          onChange={(e) => setBackupAllocationMb(e.target.value)}
                          type="number"
                          min={0}
                          step={128}
                        />
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Leave blank to use provider allocation defaults.
                        </span>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Database allocation</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={databaseAllocation}
                          onChange={(e) => setDatabaseAllocation(e.target.value)}
                          type="number"
                          min={0}
                          step={1}
                        />
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Leave blank to use provider allocation defaults.
                        </span>
                      </label>
                    </div>
                  ) : null}
                  {step === 'build' ? (
                    <>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Primary Port</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={port}
                          onChange={(e) => setPort(e.target.value)}
                          type="number"
                          min={1024}
                          max={65535}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Additional port bindings</span>
                        <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
                          <p>Format: container:host (example: 25566:25570). Host defaults to container.</p>
                          {portBindings.map((binding, index) => (
                            <div key={`${binding}-${index}`} className="flex items-center gap-2">
                              <input
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                                value={binding}
                                onChange={(event) => {
                                  const next = [...portBindings];
                                  next[index] = event.target.value;
                                  setPortBindings(next);
                                }}
                                placeholder="25566:25570"
                              />
                              <button
                                type="button"
                                className="rounded-md border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-300"
                                onClick={() => {
                                  setPortBindings(portBindings.filter((_, i) => i !== index));
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                            onClick={() => setPortBindings([...portBindings, ''])}
                          >
                            Add binding
                          </button>
                        </div>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Network</span>
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                            value={networkMode}
                            onChange={(e) =>
                              setNetworkMode(e.target.value)
                            }
                          >
                            <option value="bridge">Node IP (port mapping)</option>
                            <option value="host">Host network (no ports)</option>
                            <option value="mc-lan-static">macvlan (static IPAM)</option>
                            <option value="custom">Custom macvlan network</option>
                          </select>
                        </label>
                      {networkMode === 'custom' ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Match the network name to the CNI config on the node (for example,
                            mc-public).
                          </p>
                          <label className="block space-y-1">
                            <span className="text-slate-600 dark:text-slate-300">Network name</span>
                            <input
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                              value={customNetworkMode}
                              onChange={(event) => setCustomNetworkMode(event.target.value)}
                              placeholder="mc-public"
                            />
                          </label>
                        </div>
                      ) : null}
                      {networkMode !== 'bridge' && networkMode !== 'host' && networkMode !== 'custom' ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Choose an IP from the node pool or leave auto-assign selected.
                          </p>
                          <label className="block space-y-1">
                            <span className="text-slate-600 dark:text-slate-300">Primary IP allocation</span>
                            <select
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                              value={primaryIp}
                              onChange={(e) => setPrimaryIp(e.target.value)}
                            >
                              <option value="">Auto-assign</option>
                              {availableIps.map((ip) => (
                                <option key={ip} value={ip}>
                                  {ip}
                                </option>
                              ))}
                            </select>
                          </label>
                          {ipLoadError ? (
                            <p className="text-xs text-amber-600 dark:text-amber-300">{ipLoadError}</p>
                          ) : null}
                          {!ipLoadError && availableIps.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                              No available IPs found.
                            </p>
                          ) : null}
                        </div>
                      ) : networkMode === 'custom' ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Choose an IP from the pool tied to this custom network.
                          </p>
                          <label className="block space-y-1">
                            <span className="text-slate-600 dark:text-slate-300">Primary IP allocation</span>
                            <select
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                              value={primaryIp}
                              onChange={(e) => setPrimaryIp(e.target.value)}
                            >
                              <option value="">Auto-assign</option>
                              {availableIps.map((ip) => (
                                <option key={ip} value={ip}>
                                  {ip}
                                </option>
                              ))}
                            </select>
                          </label>
                          {ipLoadError ? (
                            <p className="text-xs text-amber-600 dark:text-amber-300">{ipLoadError}</p>
                          ) : null}
                          {!ipLoadError && availableIps.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                              No available IPs found.
                            </p>
                          ) : null}
                        </div>
                      ) : networkMode === 'bridge' ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Choose a node allocation for the default IP and port.
                          </p>
                          <label className="block space-y-1">
                            <span className="text-slate-600 dark:text-slate-300">Primary allocation</span>
                            <select
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                              value={allocationId}
                              onChange={(event) => setAllocationId(event.target.value)}
                            >
                              <option value="">Select allocation</option>
                              {availableAllocations.map((allocation) => (
                                <option key={allocation.id} value={allocation.id}>
                                  {allocation.ip}:{allocation.port}
                                  {allocation.alias ? ` (${allocation.alias})` : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          {allocLoadError ? (
                            <p className="text-xs text-amber-600 dark:text-amber-300">{allocLoadError}</p>
                          ) : null}
                          {!allocLoadError && availableAllocations.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                              No available allocations found.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {step === 'startup' ? (
                    <>
                      {templateVariables.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            Environment Variables
                          </h3>
                          {templateVariables.map((variable) => (
                            <label key={variable.name} className="block space-y-1">
                              <span className="text-slate-600 dark:text-slate-300">
                                {variable.name}
                                {variable.required && <span className="text-red-400 ml-1">*</span>}
                              </span>
                              {variable.description && (
                                <p className="text-xs text-slate-500 dark:text-slate-500">
                                  {variable.description}
                                </p>
                              )}
                              {variable.input === 'checkbox' ? (
                                <input
                                  type="checkbox"
                                  className="rounded border-slate-200 bg-white text-primary-600 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-primary-400"
                                  checked={environment[variable.name] === 'true'}
                                  onChange={(e) =>
                                    setEnvironment((prev) => ({
                                      ...prev,
                                      [variable.name]: e.target.checked ? 'true' : 'false',
                                    }))
                                  }
                                />
                              ) : (
                                <input
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                                  type={variable.input === 'number' ? 'number' : 'text'}
                                  value={environment[variable.name] || ''}
                                  onChange={(e) =>
                                    setEnvironment((prev) => ({
                                      ...prev,
                                      [variable.name]: e.target.value,
                                    }))
                                  }
                                  placeholder={variable.default}
                                />
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                      {templateVariables.length === 0 ? (
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                          No startup variables for this template.
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="p-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-between gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                {stepIndex > 0 ? (
                  <button
                    className="rounded-md border border-slate-200 px-4 py-2 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() => setStep(stepOrder[stepIndex - 1])}
                  >
                    Back
                  </button>
                ) : null}
                {stepIndex < stepOrder.length - 1 ? (
                  <button
                    className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                    onClick={() => setStep(stepOrder[stepIndex + 1])}
                    disabled={!canGoNext}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                    onClick={() => mutation.mutate()}
                    disabled={disableSubmit}
                  >
                    {mutation.isPending ? 'Creating...' : 'Create server'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CreateServerModal;
