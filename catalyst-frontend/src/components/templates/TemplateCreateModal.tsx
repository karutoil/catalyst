import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TemplateImageOption, TemplateVariable } from '../../types/template';
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
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [version, setVersion] = useState('');
  const [image, setImage] = useState('');
  const [installImage, setInstallImage] = useState('');
  const [imageOptions, setImageOptions] = useState<TemplateImageOption[]>([]);
  const [defaultImage, setDefaultImage] = useState('');
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
  const [templateFeatures, setTemplateFeatures] = useState<Record<string, any>>({});
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

  const buildTemplatePayload = (payload: any) => {
    const toNumber = (value: unknown, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const ports = Array.isArray(payload.supportedPorts)
      ? payload.supportedPorts
          .map((port: unknown) => Number(port))
          .filter((value: number) => Number.isFinite(value) && value > 0)
      : [];
    const variablesPayload = Array.isArray(payload.variables)
      ? payload.variables
          .map((variable: any) => ({
            name: String(variable?.name ?? '').trim(),
            description: variable?.description ? String(variable.description) : undefined,
            default: String(variable?.default ?? ''),
            required: Boolean(variable?.required),
            input: variable?.input ?? 'text',
            rules: Array.isArray(variable?.rules) ? variable.rules : undefined,
          }))
          .filter((variable: TemplateVariable) => variable.name)
      : [];
    const imagesPayload = Array.isArray(payload.images)
      ? payload.images
          .map((option: any) => ({
            name: String(option?.name ?? '').trim(),
            label: option?.label ? String(option.label) : undefined,
            image: String(option?.image ?? '').trim(),
          }))
          .filter((option: TemplateImageOption) => option.name && option.image)
      : [];

    return {
      name: String(payload.name ?? ''),
      description: payload.description ? String(payload.description) : undefined,
      author: String(payload.author ?? ''),
      version: String(payload.version ?? ''),
      image: String(payload.image ?? ''),
      images: imagesPayload,
      defaultImage: payload.defaultImage ? String(payload.defaultImage) : undefined,
      installImage: payload.installImage ? String(payload.installImage) : undefined,
      startup: String(payload.startup ?? ''),
      stopCommand: String(payload.stopCommand ?? ''),
      sendSignalTo: payload.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM',
      variables: variablesPayload,
      installScript: payload.installScript ? String(payload.installScript) : undefined,
      supportedPorts: ports.length ? ports : [25565],
      allocatedMemoryMb: toNumber(payload.allocatedMemoryMb, 1024),
      allocatedCpuCores: toNumber(payload.allocatedCpuCores, 2),
      features: {
        ...templateFeatures,
        ...(payload.features ?? {}),
        iconUrl: payload.features?.iconUrl ? String(payload.features.iconUrl) : undefined,
        ...(payload.features?.configFile ? { configFile: String(payload.features.configFile) } : {}),
        ...(Array.isArray(payload.features?.configFiles)
          ? { configFiles: payload.features.configFiles }
          : {}),
      },
    };
  };

  const mutation = useMutation({
    mutationFn: () =>
      templatesApi.create({
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
        supportedPorts: parsedPorts,
        allocatedMemoryMb: Number(allocatedMemoryMb),
        allocatedCpuCores: Number(allocatedCpuCores),
        features: {
          ...templateFeatures,
          ...(iconUrl ? { iconUrl } : {}),
          ...(configFile ? { configFile } : {}),
          ...(configFiles.length ? { configFiles } : {}),
        },
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
      setImageOptions([]);
      setDefaultImage('');
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
      setTemplateFeatures({});
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

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setImportError('');
    if (files.length === 1) {
      setOpen(true);
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
      reader.readAsText(files[0]);
      event.target.value = '';
      return;
    }

    setOpen(false);
    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const payload = buildTemplatePayload(parsed);
          await templatesApi.create(payload);
          return { ok: true };
        } catch (error) {
          return { ok: false };
        }
      }),
    );
    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;
    if (successCount) {
      notifySuccess(`Imported ${successCount} template${successCount === 1 ? '' : 's'}`);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
    if (failureCount) {
      notifyError(`${failureCount} template${failureCount === 1 ? '' : 's'} failed to import`);
    }
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
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
          onClick={() => {
            setImportError('');
            setOpen(true);
          }}
        >
          New Template
        </button>
        <button
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
          onClick={() => importFileRef.current?.click()}
        >
          Import JSON
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          multiple
          className="hidden"
        />
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create template</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => {
                  setOpen(false);
                  setImportError('');
                }}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Name</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Minecraft Paper"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Author</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    placeholder="Catalyst Maintainers"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Version</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="1.20.4"
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
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Import JSON (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-600 hover:file:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:file:bg-slate-800 dark:file:text-slate-600 dark:text-slate-200 dark:hover:file:bg-slate-700"
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFile}
                  />
                  {importError ? <p className="text-xs text-rose-400">{importError}</p> : null}
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Description</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Template summary"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Container image</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={image}
                    onChange={(event) => setImage(event.target.value)}
                    placeholder="itzg/minecraft-server:latest"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Default image (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={defaultImage}
                    onChange={(event) => setDefaultImage(event.target.value)}
                    placeholder="eclipse-temurin:21-jre"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Install image (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={installImage}
                    onChange={(event) => setInstallImage(event.target.value)}
                    placeholder="alpine:3.19"
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
                  placeholder="java -Xmx{{MEMORY}}M -jar server.jar"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block space-y-1 md:col-span-2">
                  <span className="text-slate-500 dark:text-slate-400">Stop command</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={stopCommand}
                    onChange={(event) => setStopCommand(event.target.value)}
                    placeholder="stop"
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
                  placeholder="#!/bin/sh"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Ports (comma separated)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={supportedPorts}
                    onChange={(event) => setSupportedPorts(event.target.value)}
                    placeholder="25565, 25566"
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
                onClick={() => {
                  setOpen(false);
                  setImportError('');
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
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
