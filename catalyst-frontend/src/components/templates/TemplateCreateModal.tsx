import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TemplateVariable } from '../../types/template';
import { templatesApi } from '../../services/api/templates';
import { notifyError, notifySuccess } from '../../utils/notify';

type VariableDraft = {
  name: string;
  description: string;
  defaultValue: string;
  required: boolean;
  input: TemplateVariable['input'];
  rules: string;
};

const createVariableDraft = (): VariableDraft => ({
  name: '',
  description: '',
  defaultValue: '',
  required: false,
  input: 'text',
  rules: '',
});

function TemplateCreateModal() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [version, setVersion] = useState('');
  const [image, setImage] = useState('');
  const [installImage, setInstallImage] = useState('');
  const [startup, setStartup] = useState('');
  const [stopCommand, setStopCommand] = useState('');
  const [sendSignalTo, setSendSignalTo] = useState<'SIGTERM' | 'SIGKILL'>('SIGTERM');
  const [installScript, setInstallScript] = useState('');
  const [configFile, setConfigFile] = useState('');
  const [configFiles, setConfigFiles] = useState<string[]>([]);
  const [supportedPorts, setSupportedPorts] = useState('25565');
  const [allocatedMemoryMb, setAllocatedMemoryMb] = useState('1024');
  const [allocatedCpuCores, setAllocatedCpuCores] = useState('2');
  const [iconUrl, setIconUrl] = useState('');
  const [variables, setVariables] = useState<VariableDraft[]>([createVariableDraft()]);
  const [importError, setImportError] = useState('');
  const queryClient = useQueryClient();

  const parsedPorts = useMemo(
    () =>
      supportedPorts
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((value) => Number.isFinite(value) && value > 0),
    [supportedPorts],
  );

  const buildVariables = () =>
    variables
      .filter((variable) => variable.name.trim())
      .map((variable) => ({
        name: variable.name.trim(),
        description: variable.description.trim() || undefined,
        default: variable.defaultValue,
        required: variable.required,
        input: variable.input,
        rules: variable.rules
          .split(',')
          .map((rule) => rule.trim())
          .filter(Boolean),
      }));

  const mutation = useMutation({
    mutationFn: () =>
      templatesApi.create({
        name,
        description: description || undefined,
        author,
        version,
        image,
        installImage: installImage || undefined,
        startup,
        stopCommand,
        sendSignalTo,
        variables: buildVariables(),
        installScript: installScript || undefined,
        supportedPorts: parsedPorts,
        allocatedMemoryMb: Number(allocatedMemoryMb),
        allocatedCpuCores: Number(allocatedCpuCores),
        features: { ...(iconUrl ? { iconUrl } : {}), ...(configFile ? { configFile } : {}), ...(configFiles.length ? { configFiles } : {}) },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      notifySuccess('Template created');
      setOpen(false);
      setName('');
      setDescription('');
      setAuthor('');
      setVersion('');
      setImage('');
      setInstallImage('');
      setStartup('');
      setStopCommand('');
      setSendSignalTo('SIGTERM');
      setInstallScript('');
      setConfigFile('');
      setConfigFiles([]);
      setSupportedPorts('25565');
      setAllocatedMemoryMb('1024');
      setAllocatedCpuCores('2');
      setIconUrl('');
      setVariables([createVariableDraft()]);
      setImportError('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create template';
      notifyError(message);
    },
  });

  const applyTemplateImport = (payload: any) => {
    if (!payload || typeof payload !== 'object') {
      setImportError('Invalid template JSON');
      return;
    }
    setImportError('');
    setName(String(payload.name ?? ''));
    setDescription(String(payload.description ?? ''));
    setAuthor(String(payload.author ?? ''));
    setVersion(String(payload.version ?? ''));
    setImage(String(payload.image ?? ''));
    setInstallImage(String(payload.installImage ?? ''));
    setStartup(String(payload.startup ?? ''));
    setStopCommand(String(payload.stopCommand ?? ''));
    setSendSignalTo(
      payload.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM',
    );
    setInstallScript(String(payload.installScript ?? ''));
    setConfigFile(String(payload.features?.configFile ?? ''));
    setConfigFiles(Array.isArray(payload.features?.configFiles) ? payload.features.configFiles : payload.features?.configFile ? [String(payload.features.configFile)] : []);
    setSupportedPorts(
      Array.isArray(payload.supportedPorts)
        ? payload.supportedPorts.join(', ')
        : '25565',
    );
    setAllocatedMemoryMb(
      payload.allocatedMemoryMb ? String(payload.allocatedMemoryMb) : '1024',
    );
    setAllocatedCpuCores(
      payload.allocatedCpuCores ? String(payload.allocatedCpuCores) : '2',
    );
    setIconUrl(String(payload.features?.iconUrl ?? ''));
    const importedVariables = Array.isArray(payload.variables)
      ? payload.variables.map((variable: any) => ({
          name: String(variable?.name ?? ''),
          description: String(variable?.description ?? ''),
          defaultValue: String(variable?.default ?? ''),
          required: Boolean(variable?.required),
          input: variable?.input ?? 'text',
          rules: Array.isArray(variable?.rules) ? variable.rules.join(', ') : '',
        }))
      : [];
    setVariables(importedVariables.length ? importedVariables : [createVariableDraft()]);
  };

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        applyTemplateImport(parsed);
      } catch (error) {
        setImportError('Failed to parse JSON file');
      }
    };
    reader.onerror = () => {
      setImportError('Unable to read file');
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const disableSubmit =
    !name ||
    !author ||
    !version ||
    !image ||
    !startup ||
    !stopCommand ||
    !parsedPorts.length ||
    !Number(allocatedMemoryMb) ||
    !Number(allocatedCpuCores) ||
    mutation.isPending;

  return (
    <div>
      <button
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500"
        onClick={() => {
          setImportError('');
          setOpen(true);
        }}
      >
        New Template
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Create template</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => {
                  setOpen(false);
                  setImportError('');
                }}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-4 text-sm text-slate-100">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-slate-300">Name</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Minecraft Paper"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">Author</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    placeholder="Catalyst Maintainers"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">Version</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="1.20.4"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">Icon URL (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={iconUrl}
                    onChange={(event) => setIconUrl(event.target.value)}
                    placeholder="https://example.com/icon.png"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">Import JSON (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-200 hover:file:bg-slate-700"
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFile}
                  />
                  {importError ? <p className="text-xs text-rose-400">{importError}</p> : null}
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-slate-300">Description</span>
                <textarea
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Template summary"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-slate-300">Container image</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={image}
                    onChange={(event) => setImage(event.target.value)}
                    placeholder="itzg/minecraft-server:latest"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">Install image (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={installImage}
                    onChange={(event) => setInstallImage(event.target.value)}
                    placeholder="alpine:3.19"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-slate-300">Config file path (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={configFile}
                  onChange={(event) => setConfigFile(event.target.value)}
                  placeholder="/config/server.properties"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Config files (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={configFiles.join(', ')}
                  onChange={(event) => {
                    const next = event.target.value
                      .split(',')
                      .map((entry) => entry.trim())
                      .filter(Boolean);
                    setConfigFiles(next);
                  }}
                  placeholder="/config/server.properties, /config/extra.yml"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Startup command</span>
                <textarea
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  rows={2}
                  value={startup}
                  onChange={(event) => setStartup(event.target.value)}
                  placeholder="java -Xmx{{MEMORY}}M -jar server.jar"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block space-y-1 md:col-span-2">
                  <span className="text-slate-300">Stop command</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={stopCommand}
                    onChange={(event) => setStopCommand(event.target.value)}
                    placeholder="stop"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">Signal</span>
                  <select
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={sendSignalTo}
                    onChange={(event) => setSendSignalTo(event.target.value as 'SIGTERM' | 'SIGKILL')}
                  >
                    <option value="SIGTERM">SIGTERM</option>
                    <option value="SIGKILL">SIGKILL</option>
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-slate-300">Install script (optional)</span>
                <textarea
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  rows={5}
                  value={installScript}
                  onChange={(event) => setInstallScript(event.target.value)}
                  placeholder="#!/bin/sh"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-slate-300">Ports (comma separated)</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={supportedPorts}
                    onChange={(event) => setSupportedPorts(event.target.value)}
                    placeholder="25565, 25566"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">Allocated memory (MB)</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    type="number"
                    min={128}
                    value={allocatedMemoryMb}
                    onChange={(event) => setAllocatedMemoryMb(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">Allocated CPU cores</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    type="number"
                    min={1}
                    step={1}
                    value={allocatedCpuCores}
                    onChange={(event) => setAllocatedCpuCores(event.target.value)}
                  />
                </label>
              </div>
              <div className="space-y-3 border-t border-slate-800 pt-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200">Variables</h3>
                  <button
                    className="rounded-md border border-slate-800 px-3 py-1 text-xs text-slate-200 hover:border-slate-700"
                    onClick={() => setVariables((prev) => [...prev, createVariableDraft()])}
                    type="button"
                  >
                    Add variable
                  </button>
                </div>
                {variables.map((variable, index) => (
                  <div key={`${variable.name}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-300">Variable {index + 1}</div>
                      {variables.length > 1 ? (
                        <button
                          className="text-xs text-rose-300 hover:text-rose-200"
                          onClick={() =>
                            setVariables((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="block space-y-1">
                        <span className="text-slate-400">Name</span>
                        <input
                          className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                          value={variable.name}
                          onChange={(event) =>
                            setVariables((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, name: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-400">Default</span>
                        <input
                          className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                          value={variable.defaultValue}
                          onChange={(event) =>
                            setVariables((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, defaultValue: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="block space-y-1 md:col-span-2">
                        <span className="text-slate-400">Description</span>
                        <input
                          className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                          value={variable.description}
                          onChange={(event) =>
                            setVariables((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, description: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          className="rounded border-slate-800 bg-slate-900 text-sky-600 focus:ring-sky-500"
                          checked={variable.required}
                          onChange={(event) =>
                            setVariables((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, required: event.target.checked } : item,
                              ),
                            )
                          }
                        />
                        Required
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-400">Input type</span>
                        <select
                          className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                          value={variable.input}
                          onChange={(event) =>
                            setVariables((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      input: event.target.value as TemplateVariable['input'],
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="select">Select</option>
                          <option value="checkbox">Checkbox</option>
                        </select>
                      </label>
                      <label className="block space-y-1 md:col-span-2">
                        <span className="text-slate-400">Rules (comma separated)</span>
                        <input
                          className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                          value={variable.rules}
                          onChange={(event) =>
                            setVariables((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, rules: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="between:512,16384"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 px-6 py-4 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => {
                  setOpen(false);
                  setImportError('');
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Creating...' : 'Create template'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default TemplateCreateModal;
