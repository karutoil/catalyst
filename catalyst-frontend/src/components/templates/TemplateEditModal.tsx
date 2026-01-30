import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Template, TemplateImageOption, TemplateVariable } from '../../types/template';
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

const createVariableDraft = (variable?: TemplateVariable): VariableDraft => ({
  name: variable?.name ?? '',
  description: variable?.description ?? '',
  defaultValue: variable?.default ?? '',
  required: Boolean(variable?.required),
  input: variable?.input ?? 'text',
  rules: variable?.rules?.join(', ') ?? '',
});

function TemplateEditModal({ template }: { template: Template }) {
  const [open, setOpen] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [author, setAuthor] = useState(template.author);
  const [version, setVersion] = useState(template.version);
  const [image, setImage] = useState(template.image);
  const [installImage, setInstallImage] = useState(template.installImage ?? '');
  const [imageOptions, setImageOptions] = useState<TemplateImageOption[]>(
    template.images ?? [],
  );
  const [defaultImage, setDefaultImage] = useState(template.defaultImage ?? '');
  const [startup, setStartup] = useState(template.startup);
  const [stopCommand, setStopCommand] = useState(template.stopCommand);
  const [sendSignalTo, setSendSignalTo] = useState<'SIGTERM' | 'SIGKILL'>(
    template.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM',
  );
  const [installScript, setInstallScript] = useState(template.installScript ?? '');
  const [configFile, setConfigFile] = useState(template.features?.configFile ?? '');
  const [configFiles, setConfigFiles] = useState<string[]>(template.features?.configFiles ?? []);
  const [supportedPorts, setSupportedPorts] = useState(
    template.supportedPorts?.length ? template.supportedPorts.join(', ') : '25565',
  );
  const [allocatedMemoryMb, setAllocatedMemoryMb] = useState(String(template.allocatedMemoryMb));
  const [allocatedCpuCores, setAllocatedCpuCores] = useState(String(template.allocatedCpuCores));
  const [iconUrl, setIconUrl] = useState(template.features?.iconUrl ?? '');
  const [templateFeatures, setTemplateFeatures] = useState<Record<string, any>>(
    template.features ?? {},
  );
  const [variables, setVariables] = useState<VariableDraft[]>(
    template.variables?.length
      ? template.variables.map((variable) => createVariableDraft(variable))
      : [createVariableDraft()],
  );
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

  const resetFromTemplate = () => {
    setImportError('');
    setName(template.name);
    setDescription(template.description ?? '');
    setAuthor(template.author);
    setVersion(template.version);
    setImage(template.image);
    setInstallImage(template.installImage ?? '');
    setImageOptions(template.images ?? []);
    setDefaultImage(template.defaultImage ?? '');
    setStartup(template.startup);
    setStopCommand(template.stopCommand);
    setSendSignalTo(template.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
    setInstallScript(template.installScript ?? '');
    setConfigFile(template.features?.configFile ?? '');
    setConfigFiles(template.features?.configFiles ?? (template.features?.configFile ? [template.features.configFile] : []));
    setSupportedPorts(
      template.supportedPorts?.length ? template.supportedPorts.join(', ') : '25565',
    );
    setAllocatedMemoryMb(String(template.allocatedMemoryMb));
    setAllocatedCpuCores(String(template.allocatedCpuCores));
    setIconUrl(template.features?.iconUrl ?? '');
    setTemplateFeatures(template.features ?? {});
    setVariables(
      template.variables?.length
        ? template.variables.map((variable) => createVariableDraft(variable))
        : [createVariableDraft()],
    );
  };

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
    setImageOptions(
      Array.isArray(payload.images)
        ? payload.images.map((option: any) => ({
            name: String(option?.name ?? ''),
            label: option?.label ? String(option.label) : undefined,
            image: String(option?.image ?? ''),
          }))
        : [],
    );
    setDefaultImage(String(payload.defaultImage ?? ''));
    setInstallImage(String(payload.installImage ?? ''));
    setStartup(String(payload.startup ?? ''));
    setStopCommand(String(payload.stopCommand ?? ''));
    setSendSignalTo(payload.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
    setInstallScript(String(payload.installScript ?? ''));
    setConfigFile(String(payload.features?.configFile ?? ''));
    setConfigFiles(
      Array.isArray(payload.features?.configFiles)
        ? payload.features.configFiles
        : payload.features?.configFile
          ? [String(payload.features.configFile)]
          : [],
    );
    setSupportedPorts(
      Array.isArray(payload.supportedPorts) ? payload.supportedPorts.join(', ') : '25565',
    );
    setAllocatedMemoryMb(payload.allocatedMemoryMb ? String(payload.allocatedMemoryMb) : '1024');
    setAllocatedCpuCores(payload.allocatedCpuCores ? String(payload.allocatedCpuCores) : '2');
    setIconUrl(String(payload.features?.iconUrl ?? ''));
    setTemplateFeatures(payload.features ?? {});
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
    setImportError('');
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

  const mutation = useMutation({
    mutationFn: () =>
      templatesApi.update(template.id, {
        name,
        description: description || undefined,
        author,
        version,
        image,
        images: imageOptions.filter((option) => option.name && option.image),
        defaultImage: defaultImage || undefined,
        installImage: installImage || undefined,
        startup,
        stopCommand,
        sendSignalTo,
        variables: buildVariables(),
        installScript: installScript || undefined,
        features: {
          ...templateFeatures,
          iconUrl: iconUrl || undefined,
          ...(configFile ? { configFile } : {}),
          ...(configFiles.length ? { configFiles } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['template', template.id] });
      notifySuccess('Template updated');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update template';
      notifyError(message);
    },
  });

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
        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
        onClick={() => {
          resetFromTemplate();
          setOpen(true);
        }}
      >
        Edit
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Edit template</h2>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => importFileRef.current?.click()}
                >
                  Import JSON
                </button>
                <button
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </div>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
              {importError ? <p className="text-xs text-rose-400">{importError}</p> : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Name</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Author</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Version</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Icon URL (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={iconUrl}
                    onChange={(event) => setIconUrl(event.target.value)}
                    placeholder="https://example.com/icon.png"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Description</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Container image</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={image}
                    onChange={(event) => setImage(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Default image (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={defaultImage}
                    onChange={(event) => setDefaultImage(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Install image (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={installImage}
                    onChange={(event) => setInstallImage(event.target.value)}
                  />
                </label>
              </div>
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                    Image variants
                  </div>
                  <button
                    className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() =>
                      setImageOptions((prev) => [...prev, { name: '', label: '', image: '' }])
                    }
                    type="button"
                  >
                    Add image
                  </button>
                </div>
                {imageOptions.length ? (
                  <div className="space-y-2">
                    {imageOptions.map((option, index) => (
                      <div
                        key={`${option.name}-${index}`}
                        className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
                      >
                        <label className="block space-y-1">
                          <span className="text-xs text-slate-500 dark:text-slate-400">Name</span>
                          <input
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                            value={option.name}
                            onChange={(event) =>
                              setImageOptions((prev) =>
                                prev.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, name: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs text-slate-500 dark:text-slate-400">Label</span>
                          <input
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                            value={option.label ?? ''}
                            onChange={(event) =>
                              setImageOptions((prev) =>
                                prev.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, label: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs text-slate-500 dark:text-slate-400">Image</span>
                          <input
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                            value={option.image}
                            onChange={(event) =>
                              setImageOptions((prev) =>
                                prev.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, image: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-300"
                          onClick={() =>
                            setImageOptions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Add optional image variants for selectable runtimes.
                  </p>
                )}
              </div>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Config file path (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={configFile}
                  onChange={(event) => setConfigFile(event.target.value)}
                  placeholder="/config/server.properties"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Config files (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                <span className="text-slate-500 dark:text-slate-400">Startup command</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  rows={2}
                  value={startup}
                  onChange={(event) => setStartup(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block space-y-1 md:col-span-2">
                  <span className="text-slate-500 dark:text-slate-400">Stop command</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={stopCommand}
                    onChange={(event) => setStopCommand(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Signal</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={sendSignalTo}
                    onChange={(event) => setSendSignalTo(event.target.value as 'SIGTERM' | 'SIGKILL')}
                  >
                    <option value="SIGTERM">SIGTERM</option>
                    <option value="SIGKILL">SIGKILL</option>
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Install script (optional)</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  rows={5}
                  value={installScript}
                  onChange={(event) => setInstallScript(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Ports (comma separated)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={supportedPorts}
                    onChange={(event) => setSupportedPorts(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Allocated memory (MB)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    type="number"
                    min={128}
                    value={allocatedMemoryMb}
                    onChange={(event) => setAllocatedMemoryMb(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Allocated CPU cores</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    type="number"
                    min={1}
                    step={1}
                    value={allocatedCpuCores}
                    onChange={(event) => setAllocatedCpuCores(event.target.value)}
                  />
                </label>
              </div>
              <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                    Variables
                  </h3>
                  <button
                    className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() => setVariables((prev) => [...prev, createVariableDraft()])}
                    type="button"
                  >
                    Add variable
                  </button>
                </div>
                {variables.map((variable, index) => (
                  <div
                    key={`${variable.name}-${index}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-primary-500/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Variable {index + 1}
                      </div>
                      {variables.length > 1 ? (
                        <button
                          className="text-xs text-rose-500 transition-all duration-300 hover:text-rose-400 dark:text-rose-300"
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
                        <span className="text-slate-500 dark:text-slate-400">Name</span>
                        <input
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                        <span className="text-slate-500 dark:text-slate-400">Default</span>
                        <input
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                        <span className="text-slate-500 dark:text-slate-400">Description</span>
                        <input
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                      <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 bg-white text-primary-600 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-primary-400 dark:focus:ring-primary-400"
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
                        <span className="text-slate-500 dark:text-slate-400">Input type</span>
                        <select
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                        <span className="text-slate-500 dark:text-slate-400">
                          Rules (comma separated)
                        </span>
                        <input
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default TemplateEditModal;
