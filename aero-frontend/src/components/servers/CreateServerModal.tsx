import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { useTemplates } from '../../hooks/useTemplates';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Template } from '../../types/template';

function CreateServerModal() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [port, setPort] = useState('25565');
  const [environment, setEnvironment] = useState<Record<string, string>>({});

  const { data: templates = [] } = useTemplates();
  const { data: nodes = [] } = useNodes();
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

  const mutation = useMutation({
    mutationFn: async () => {
      // Create server first
      const server = await serversApi.create({
        name,
        templateId,
        nodeId,
        locationId,
        allocatedMemoryMb: Number(memory),
        allocatedCpuCores: Number(cpu),
        primaryPort: Number(port),
        networkMode: 'bridge',
        environment,
      });
      
      // Then trigger installation
      if (server?.id) {
        await serversApi.install(server.id);
      }
      
      return server;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess('Server created and installation started');
      setOpen(false);
      setName('');
      setTemplateId('');
      setNodeId('');
      setEnvironment({});
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create server';
      notifyError(message);
    },
  });

  const disableSubmit = !name || !templateId || !nodeId || mutation.isPending;

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
