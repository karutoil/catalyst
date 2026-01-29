import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { useTemplates } from '../../hooks/useTemplates';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Template } from '../../types/template';
import { nodesApi } from '../../services/api/nodes';

function CreateServerModal() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [disk, setDisk] = useState('10240');
  const [port, setPort] = useState('25565');
  const [portBindings, setPortBindings] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [networkMode, setNetworkMode] = useState<'bridge' | 'mc-lan' | 'mc-lan-static'>(
    'mc-lan-static',
  );
  const [primaryIp, setPrimaryIp] = useState('');
  const [allocationId, setAllocationId] = useState('');
  const [availableAllocations, setAvailableAllocations] = useState<
    Array<{ id: string; ip: string; port: number; alias?: string | null }>
  >([]);
  const [allocLoadError, setAllocLoadError] = useState<string | null>(null);
  const navigate = useNavigate();

  const { data: templates = [] } = useTemplates();
  const { data: nodes = [] } = useNodes();
  const [availableIps, setAvailableIps] = useState<string[]>([]);
  const [ipLoadError, setIpLoadError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Get selected template
  const selectedTemplate = useMemo(() => {
    return templates.find(t => t.id === templateId);
  }, [templates, templateId]);

  // Filter out SERVER_DIR from variables
  const templateVariables = useMemo(() => {
    if (!selectedTemplate?.variables) return [];
    return selectedTemplate.variables.filter(v => v.name !== 'SERVER_DIR');
  }, [selectedTemplate]);

  // Get first node location (for now, since we need locationId)
  const locationId = nodes[0]?.locationId || '';

  useEffect(() => {
    setPrimaryIp('');
    let active = true;
    if (!nodeId || networkMode !== 'mc-lan-static') {
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
        templateId,
        nodeId,
        locationId,
        allocatedMemoryMb: Number(memory),
        allocatedCpuCores: Number(cpu),
        allocatedDiskMb: Number(disk),
        primaryPort: Number(port),
        portBindings: Object.keys(normalizedBindings).length ? normalizedBindings : undefined,
        networkMode,
        environment: {
          ...environment,
        },
      };
      if (networkMode === 'mc-lan-static') {
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
      setTemplateId('');
      setNodeId('');
      setEnvironment({});
      setNetworkMode('mc-lan-static');
      setPrimaryIp('');
      setPortBindings([]);
      if (server?.id) {
        navigate(`/servers/${server.id}/console`);
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create server';
      notifyError(message);
    },
  });

  const disableSubmit =
    !name ||
    !templateId ||
    !nodeId ||
    mutation.isPending ||
    false;

  return (
    <div>
      <button
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500"
        onClick={() => setOpen(true)}
      >
        New Server
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg max-h-[90vh] rounded-xl border border-slate-800 bg-slate-950 shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-800">
              <h2 className="text-lg font-semibold text-slate-100">Create server</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-3 text-sm text-slate-100">
              <label className="block space-y-1">
                <span className="text-slate-300">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="minecraft-01"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Template</span>
                <select
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={templateId}
                  onChange={(e) => {
                    const newTemplateId = e.target.value;
                    setTemplateId(newTemplateId);
                    
                    // Initialize environment with default values for all variables
                    const template = templates.find(t => t.id === newTemplateId);
                    if (template?.variables) {
                      const defaultEnv: Record<string, string> = {};
                      template.variables
                        .filter(v => v.name !== 'SERVER_DIR')
                        .forEach(v => {
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
              <label className="block space-y-1">
                <span className="text-slate-300">Node</span>
                <select
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
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
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-slate-300">Memory (MB)</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={memory}
                    onChange={(e) => setMemory(e.target.value)}
                    type="number"
                    min={256}
                  />
                </label>
              <label className="block space-y-1">
                <span className="text-slate-300">CPU cores</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={cpu}
                  onChange={(e) => setCpu(e.target.value)}
                  type="number"
                  min={1}
                  step={1}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Disk (MB)</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={disk}
                  onChange={(e) => setDisk(e.target.value)}
                  type="number"
                  min={1024}
                  step={1024}
                />
              </label>
              </div>
              <label className="block space-y-1">
                <span className="text-slate-300">Primary Port</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  type="number"
                  min={1024}
                  max={65535}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Additional port bindings</span>
                <div className="space-y-2 text-xs text-slate-400">
                  <p>Format: container:host (example: 25566:25570). Host defaults to container.</p>
                  {portBindings.map((binding, index) => (
                    <div key={`${binding}-${index}`} className="flex items-center gap-2">
                      <input
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
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
                        className="rounded-md border border-rose-700 px-2 py-1 text-[10px] font-semibold text-rose-200 hover:border-rose-500"
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
                    className="rounded-md border border-slate-800 px-3 py-1 text-xs text-slate-200 hover:border-slate-700"
                    onClick={() => setPortBindings([...portBindings, ''])}
                  >
                    Add binding
                  </button>
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Network</span>
                <select
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={networkMode}
                  onChange={(e) =>
                    setNetworkMode(e.target.value as 'bridge' | 'mc-lan' | 'mc-lan-static')
                  }
                >
                  <option value="bridge">Node IP (port mapping)</option>
                  <option value="mc-lan">macvlan (DHCP)</option>
                  <option value="mc-lan-static">macvlan (static IPAM)</option>
                </select>
              </label>
              {networkMode === 'mc-lan-static' ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">
                    Choose an IP from the node pool or leave auto-assign selected.
                  </p>
                  <label className="block space-y-1">
                    <span className="text-slate-300">Primary IP allocation</span>
                    <select
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
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
                    <p className="text-xs text-amber-300">{ipLoadError}</p>
                  ) : null}
                  {!ipLoadError && availableIps.length === 0 ? (
                    <p className="text-xs text-slate-500">No available IPs found.</p>
                  ) : null}
                </div>
              ) : networkMode === 'bridge' ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">
                    Choose a node allocation for the default IP and port.
                  </p>
                  <label className="block space-y-1">
                    <span className="text-slate-300">Primary allocation</span>
                    <select
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
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
                    <p className="text-xs text-amber-300">{allocLoadError}</p>
                  ) : null}
                  {!allocLoadError && availableAllocations.length === 0 ? (
                    <p className="text-xs text-slate-500">No available allocations found.</p>
                  ) : null}
                </div>
              ) : null}
              {templateVariables.length > 0 && (
                <div className="space-y-3 border-t border-slate-800 pt-3">
                  <h3 className="text-sm font-semibold text-slate-200">Environment Variables</h3>
                  {templateVariables.map((variable) => (
                    <label key={variable.name} className="block space-y-1">
                      <span className="text-slate-300">
                        {variable.name}
                        {variable.required && <span className="text-red-400 ml-1">*</span>}
                      </span>
                      {variable.description && (
                        <p className="text-xs text-slate-500">{variable.description}</p>
                      )}
                      {variable.input === 'checkbox' ? (
                        <input
                          type="checkbox"
                          className="rounded border-slate-800 bg-slate-900 text-sky-600 focus:ring-sky-500"
                          checked={environment[variable.name] === 'true'}
                          onChange={(e) => setEnvironment(prev => ({
                            ...prev,
                            [variable.name]: e.target.checked ? 'true' : 'false'
                          }))}
                        />
                      ) : (
                        <input
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                          type={variable.input === 'number' ? 'number' : 'text'}
                          value={environment[variable.name] || ''}
                          onChange={(e) => setEnvironment(prev => ({
                            ...prev,
                            [variable.name]: e.target.value
                          }))}
                          placeholder={variable.default}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 pt-4 border-t border-slate-800 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Creating...' : 'Create server'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CreateServerModal;
