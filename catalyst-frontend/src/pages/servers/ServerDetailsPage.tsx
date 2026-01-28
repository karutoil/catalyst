import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useServer } from '../../hooks/useServer';
import { useServerMetrics } from '../../hooks/useServerMetrics';
import { useServerMetricsHistory } from '../../hooks/useServerMetricsHistory';
import { formatBytes } from '../../utils/formatters';
import { useWebSocketStore } from '../../stores/websocketStore';
import ServerControls from '../../components/servers/ServerControls';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import ServerMetrics from '../../components/servers/ServerMetrics';
import ServerMetricsTrends from '../../components/servers/ServerMetricsTrends';
import UpdateServerModal from '../../components/servers/UpdateServerModal';
import TransferServerModal from '../../components/servers/TransferServerModal';
import DeleteServerDialog from '../../components/servers/DeleteServerDialog';
import FileManager from '../../components/files/FileManager';
import BackupSection from '../../components/backups/BackupSection';
import CreateTaskModal from '../../components/tasks/CreateTaskModal';
import EditTaskModal from '../../components/tasks/EditTaskModal';
import XtermConsole from '../../components/console/XtermConsole';
import { useConsole } from '../../hooks/useConsole';
import { useTasks } from '../../hooks/useTasks';
import { useServerDatabases } from '../../hooks/useServerDatabases';
import { useDatabaseHosts } from '../../hooks/useAdmin';
import { useAuthStore } from '../../stores/authStore';
import { serversApi } from '../../services/api/servers';
import { filesApi } from '../../services/api/files';
import { databasesApi } from '../../services/api/databases';
import { notifyError, notifySuccess } from '../../utils/notify';
import {
  detectConfigFormat,
  parseConfig,
  serializeConfig,
  type ConfigMap,
  type ConfigNode,
} from '../../utils/configFormats';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../../services/api/tasks';

type ConfigEntry = {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'null' | 'object';
  children?: ConfigEntry[];
};
type ConfigSection = {
  title: string;
  entries: ConfigEntry[];
  collapsed?: boolean;
};
type ConfigFileState = {
  path: string;
  sections: ConfigSection[];
  format: ReturnType<typeof detectConfigFormat>;
  error: string | null;
  loaded: boolean;
  viewMode: 'form' | 'raw';
  rawContent: string;
};

const tabLabels = {
  console: 'Console',
  files: 'Files',
  backups: 'Backups',
  tasks: 'Tasks',
  databases: 'Databases',
  metrics: 'Metrics',
  configuration: 'Configuration',
  settings: 'Settings',
} as const;

function ServerDetailsPage() {
  const { serverId, tab } = useParams();
  const navigate = useNavigate();
  const { data: server, isLoading, isError } = useServer(serverId);
  const liveMetrics = useServerMetrics(serverId, server?.allocatedMemoryMb);
  const { data: metricsHistory } = useServerMetricsHistory(serverId);
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(serverId);
  const { data: databases = [], isLoading: databasesLoading, isError: databasesError } =
    useServerDatabases(serverId);
  const { data: databaseHosts = [] } = useDatabaseHosts();
  const { isConnected } = useWebSocketStore();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const {
    entries,
    send,
    isLoading: consoleLoading,
    isError: consoleError,
    refetch: refetchConsole,
    clear: clearConsole,
  } = useConsole(serverId);

  const isSuspended = server?.status === 'suspended';
  const activeTab = useMemo(() => {
    const key = tab ?? 'console';
    return key in tabLabels ? (key as keyof typeof tabLabels) : 'console';
  }, [tab]);

  const canSend = isConnected && Boolean(serverId) && server?.status === 'running' && !isSuspended;
  const canManageDatabases =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.read') ||
    user?.permissions?.includes('database.create') ||
    user?.permissions?.includes('database.read') ||
    user?.permissions?.includes('database.rotate') ||
    user?.permissions?.includes('database.delete') ||
    Boolean(server && user?.id && server.ownerId === user.id);
  const [configFiles, setConfigFiles] = useState<ConfigFileState[]>([]);
  const [openConfigIndex, setOpenConfigIndex] = useState(-1);
  const [command, setCommand] = useState('');
  const [configSearch, setConfigSearch] = useState('');
  const [databaseHostId, setDatabaseHostId] = useState('');
  const [databaseName, setDatabaseName] = useState('');
  const [allocations, setAllocations] = useState<{ containerPort: number; hostPort: number; isPrimary: boolean }[]>([]);
  const [allocationsError, setAllocationsError] = useState<string | null>(null);
  const [newContainerPort, setNewContainerPort] = useState('');
  const [newHostPort, setNewHostPort] = useState('');
  const [restartPolicy, setRestartPolicy] = useState<'always' | 'on-failure' | 'never'>('on-failure');
  const [maxCrashCount, setMaxCrashCount] = useState('5');

  const createDatabaseMutation = useMutation({
    mutationFn: () => {
      if (!server?.id) throw new Error('Server not loaded');
      if (!databaseHostId) throw new Error('Database host required');
      return databasesApi.create(server.id, {
        hostId: databaseHostId,
        name: databaseName.trim() || undefined,
      });
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['server-databases', server.id] });
      }
      setDatabaseName('');
      notifySuccess('Database created');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create database';
      notifyError(message);
    },
  });

  const rotateDatabaseMutation = useMutation({
    mutationFn: (databaseId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return databasesApi.rotatePassword(server.id, databaseId);
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['server-databases', server.id] });
      }
      notifySuccess('Database password rotated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to rotate password';
      notifyError(message);
    },
  });

  const deleteDatabaseMutation = useMutation({
    mutationFn: (databaseId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return databasesApi.remove(server.id, databaseId);
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['server-databases', server.id] });
      }
      notifySuccess('Database deleted');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete database';
      notifyError(message);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (task: { id: string; enabled: boolean }) => {
      if (!server?.id) throw new Error('Server not loaded');
      return tasksApi.update(server.id, task.id, { enabled: !task.enabled });
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['tasks', server.id] });
      }
      notifySuccess('Task updated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update task';
      notifyError(message);
    },
  });

  const configMutation = useMutation({
    mutationFn: async (index: number) => {
      if (!serverId) {
        throw new Error('Missing server id');
      }
      const target = configFiles[index];
      if (!target || !target.format) {
        throw new Error('Missing config file path');
      }
      if (target.viewMode === 'raw') {
        await filesApi.write(serverId, target.path, target.rawContent);
        return;
      }
      const record = buildConfigRecord(target.sections);
      const content = serializeConfig(target.format, record);
      await filesApi.write(serverId, target.path, content);
    },
    onSuccess: () => {
      notifySuccess('Configuration saved');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to save config';
      notifyError(message);
    },
  });

  const loadAllocations = useCallback(async () => {
    if (!serverId) return;
    try {
      const data = await serversApi.allocations(serverId);
      setAllocations(data || []);
      setAllocationsError(null);
    } catch (error: any) {
      const message = error?.response?.data?.error || 'Unable to load allocations';
      setAllocationsError(message);
    }
  }, [serverId]);

  const addAllocationMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      const containerPort = Number(newContainerPort);
      const hostPort = Number(newHostPort || newContainerPort);
      if (!Number.isFinite(containerPort) || containerPort <= 0) {
        throw new Error('Invalid container port');
      }
      if (!Number.isFinite(hostPort) || hostPort <= 0) {
        throw new Error('Invalid host port');
      }
      return serversApi.addAllocation(serverId, { containerPort, hostPort });
    },
    onSuccess: () => {
      notifySuccess('Allocation added');
      setNewContainerPort('');
      setNewHostPort('');
      loadAllocations();
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to add allocation';
      notifyError(message);
    },
  });

  const removeAllocationMutation = useMutation({
    mutationFn: async (containerPort: number) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.removeAllocation(serverId, containerPort);
    },
    onSuccess: () => {
      notifySuccess('Allocation removed');
      loadAllocations();
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to remove allocation';
      notifyError(message);
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (containerPort: number) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.setPrimaryAllocation(serverId, containerPort);
    },
    onSuccess: () => {
      notifySuccess('Primary allocation updated');
      loadAllocations();
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update primary allocation';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return tasksApi.remove(server.id, taskId);
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['tasks', server.id] });
      }
      notifySuccess('Task deleted');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete task';
      notifyError(message);
    },
  });

  const restartPolicyMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      const parsedMax = maxCrashCount.trim() === '' ? undefined : Number(maxCrashCount);
      const minCrashCount = restartPolicy === 'always' ? 1 : 0;
      if (
        parsedMax !== undefined &&
        (!Number.isFinite(parsedMax) || parsedMax < minCrashCount || parsedMax > 100)
      ) {
        throw new Error(`Max crash count must be between ${minCrashCount} and 100`);
      }
      return serversApi.updateRestartPolicy(serverId, {
        restartPolicy,
        maxCrashCount: parsedMax,
      });
    },
    onSuccess: () => {
      notifySuccess('Restart policy updated');
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to update restart policy';
      notifyError(message);
    },
  });

  const resetCrashCountMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.resetCrashCount(serverId);
    },
    onSuccess: () => {
      notifySuccess('Crash count reset');
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to reset crash count';
      notifyError(message);
    },
  });

  useEffect(() => {
    if (!server) return;
    setRestartPolicy(server.restartPolicy ?? 'on-failure');
    setMaxCrashCount(
      server.maxCrashCount !== undefined && server.maxCrashCount !== null
        ? String(server.maxCrashCount)
        : '5',
    );
  }, [server?.id, server?.restartPolicy, server?.maxCrashCount]);

  const normalizeEntry = (key: string, value: ConfigNode): ConfigEntry => {
    if (isConfigMap(value)) {
      const children = Object.entries(value).map(([childKey, childValue]) =>
        normalizeEntry(childKey, childValue),
      );
      return { key, value: '', type: 'object', children };
    }
    if (value === null) {
      return { key, value: '', type: 'null' };
    }
    if (typeof value === 'boolean') {
      return { key, value: value ? 'true' : 'false', type: 'boolean' };
    }
    if (typeof value === 'number') {
      return { key, value: String(value), type: 'number' };
    }
    return { key, value: String(value), type: 'string' };
  };

  const isConfigMap = (value: ConfigNode): value is ConfigMap =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const toSections = (record: ConfigMap): ConfigSection[] => {
    const rootEntries: ConfigEntry[] = [];
    const sections: ConfigSection[] = [];
    Object.entries(record).forEach(([key, value]) => {
      if (isConfigMap(value)) {
        const nestedEntries = Object.entries(value).map(([childKey, childValue]) =>
          normalizeEntry(childKey, childValue),
        );
        sections.push({ title: key, entries: nestedEntries, collapsed: true });
      } else {
        rootEntries.push(normalizeEntry(key, value));
      }
    });
    if (rootEntries.length || sections.length === 0) {
      sections.unshift({ title: 'General', entries: rootEntries, collapsed: false });
    }
    return sections;
  };

  const buildConfigRecord = (sections: ConfigSection[]): ConfigMap => {
    const record: ConfigMap = {};
    const inferType = (raw: string): ConfigEntry['type'] => {
      const trimmed = raw.trim();
      if (trimmed === '') return 'string';
      if (trimmed === 'true' || trimmed === 'false') return 'boolean';
      if (trimmed === 'null') return 'null';
      if (!Number.isNaN(Number(trimmed))) return 'number';
      return 'string';
    };
    const normalizeValue = (entry: ConfigEntry): ConfigNode => {
      const resolvedType = entry.type === 'string' ? inferType(entry.value) : entry.type;
      switch (resolvedType) {
        case 'number':
          return entry.value === '' ? 0 : Number(entry.value);
        case 'boolean':
          return entry.value === 'true';
        case 'null':
          return null;
        case 'object': {
          const output: ConfigMap = {};
          (entry.children ?? []).forEach((child) => {
            if (!child.key.trim()) return;
            output[child.key] = normalizeValue(child);
          });
          return output;
        }
        default:
          return entry.value;
      }
    };

    sections.forEach((section) => {
      const target =
        section.title === 'General' ? record : ((record[section.title] ||= {}) as ConfigMap);
      section.entries.forEach((entry) => {
        if (!entry.key.trim()) return;
        target[entry.key] = normalizeValue(entry);
      });
    });
    return record;
  };

  const loadConfigFile = useCallback(async (pathValue: string) => {
    const format = detectConfigFormat(pathValue);
    if (!format) {
      return {
        path: pathValue,
        sections: [],
        format: null,
        error: 'Unsupported config format.',
        loaded: true,
        viewMode: 'form',
        rawContent: '',
      } as ConfigFileState;
    }
    try {
      const content = await filesApi.readText(serverId ?? '', pathValue);
      const parsed = parseConfig(format, content);
      const sections = toSections(parsed);
      return {
        path: pathValue,
        sections,
        format,
        error: null,
        loaded: true,
        viewMode: 'form',
        rawContent: content,
      };
    } catch (error: any) {
      return {
        path: pathValue,
        sections: [],
        format,
        error: error?.message || 'Failed to load config file',
        loaded: true,
        viewMode: 'form',
        rawContent: '',
      };
    }
  }, [serverId]);

  const filteredConfigFiles = useMemo(() => {
    const query = configSearch.trim().toLowerCase();
    if (!query) {
      return configFiles;
    }
    const matchesEntry = (entry: ConfigEntry) => {
      if (entry.key.toLowerCase().includes(query)) return true;
      if (entry.value.toLowerCase().includes(query)) return true;
      return (entry.children ?? []).some(matchesEntry);
    };
    return configFiles
      .map((file) => {
        if (file.viewMode === 'raw') {
          return file.rawContent.toLowerCase().includes(query) ? file : null;
        }
        const sections = file.sections
          .map((section) => {
            const entries = section.entries.filter(matchesEntry);
            if (!entries.length) return null;
            return { ...section, entries, collapsed: false };
          })
          .filter(Boolean) as ConfigSection[];
        return sections.length ? { ...file, sections } : null;
      })
      .filter(Boolean) as ConfigFileState[];
  }, [configFiles, configSearch]);

  const fileIndexByPath = useMemo(() => {
    const mapping = new Map<string, number>();
    configFiles.forEach((file, index) => {
      mapping.set(file.path, index);
    });
    return mapping;
  }, [configFiles]);

  const renderValueInput = (
    entry: ConfigEntry,
    onValueChange: (value: string) => void,
    className = 'w-full',
  ) => {
    if (entry.type === 'boolean') {
      const checked = entry.value === 'true';
      return (
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            onChange={(event) => onValueChange(event.target.checked ? 'true' : 'false')}
          />
          <div className="h-5 w-10 rounded-full bg-slate-600 transition peer-checked:bg-sky-500">
            <div className="h-4 w-4 translate-x-0.5 translate-y-0.5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
          </div>
        </label>
      );
    }

    return (
      <input
        type={entry.type === 'number' ? 'number' : 'text'}
        className={`${className} rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-50 focus:border-sky-400 focus:outline-none`}
        value={entry.value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Value"
      />
    );
  };

  const updateConfigEntry = useCallback(
    (
      fileIndex: number,
      sectionIndex: number,
      entryIndex: number,
      patch: Partial<ConfigEntry>,
      childIndex?: number,
    ) => {
      setConfigFiles((current) =>
        current.map((file, idx) => {
          if (idx !== fileIndex) return file;
          return {
            ...file,
            sections: file.sections.map((section, secIdx) => {
              if (secIdx !== sectionIndex) return section;
              return {
                ...section,
                entries: section.entries.map((entry, entryIdx) => {
                  if (entryIdx !== entryIndex) return entry;
                  if (typeof childIndex === 'number' && entry.children) {
                    return {
                      ...entry,
                      children: entry.children.map((child, childIdx) =>
                        childIdx === childIndex ? { ...child, ...patch } : child,
                      ),
                    };
                  }
                  return { ...entry, ...patch };
                }),
              };
            }),
          };
        }),
      );
    },
    [],
  );

  const addConfigEntry = useCallback((fileIndex: number, sectionIndex: number, parentIndex?: number) => {
    setConfigFiles((current) =>
      current.map((file, idx) =>
        idx === fileIndex
          ? {
              ...file,
              sections: file.sections.map((section, secIdx) => {
                if (secIdx !== sectionIndex) return section;
                if (typeof parentIndex === 'number') {
                  return {
                    ...section,
                    entries: section.entries.map((entry, entryIdx) =>
                      entryIdx === parentIndex
                        ? {
                            ...entry,
                            children: [...(entry.children ?? []), { key: '', value: '', type: 'string' }],
                          }
                        : entry,
                    ),
                  };
                }
                return { ...section, entries: [...section.entries, { key: '', value: '', type: 'string' }] };
              }),
            }
          : file,
      ),
    );
  }, []);

  const removeConfigEntry = useCallback(
    (fileIndex: number, sectionIndex: number, entryIndex: number, childIndex?: number) => {
      setConfigFiles((current) =>
        current.map((file, idx) =>
          idx === fileIndex
            ? {
                ...file,
                sections: file.sections.map((section, secIdx) => {
                  if (secIdx !== sectionIndex) return section;
                  if (typeof childIndex === 'number') {
                    return {
                      ...section,
                      entries: section.entries.map((entry, entryIdx) =>
                        entryIdx === entryIndex
                          ? {
                              ...entry,
                              children: (entry.children ?? []).filter((_, childIdx) => childIdx !== childIndex),
                            }
                          : entry,
                      ),
                    };
                  }
                  return { ...section, entries: section.entries.filter((_, entryIdx) => entryIdx !== entryIndex) };
                }),
              }
            : file,
        ),
      );
    },
    [],
  );

  const handleSend = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    const trimmed = command.trim();
    if (!trimmed) return;
    send(trimmed);
    setCommand('');
  }, [canSend, command, send]);

  const handleReinstall = useCallback(async () => {
    if (!serverId) return;
    try {
      await serversApi.install(serverId);
      notifySuccess('Reinstall started');
    } catch (error: any) {
      const message = error?.response?.data?.error || 'Failed to reinstall server';
      notifyError(message);
    }
  }, [serverId]);

  useEffect(() => {
    if (!serverId || !server || !server.template) {
      setConfigFiles([]);
      return;
    }
    const configTemplatePath = server.template?.features?.configFile;
    const configTemplatePaths = server.template?.features?.configFiles ?? [];
    const combinedConfigPaths = [
      ...(configTemplatePath ? [configTemplatePath] : []),
      ...configTemplatePaths,
    ];
    
    if (combinedConfigPaths.length === 0) {
      setConfigFiles([]);
      return;
    }
    const uniquePaths = Array.from(new Set(combinedConfigPaths));
    setConfigFiles(
      uniquePaths.map((path) => ({
        path,
        sections: [],
        format: null,
        error: null,
        loaded: false,
        viewMode: 'form',
        rawContent: '',
      })),
    );
    setOpenConfigIndex(-1);
    Promise.all(uniquePaths.map((path) => loadConfigFile(path))).then((results) => {
      setConfigFiles(results);
    });
  }, [serverId, server?.template?.features?.configFile, server?.template?.features?.configFiles?.join('|'), loadConfigFile]);

  useEffect(() => {
    loadAllocations();
  }, [loadAllocations]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
        Loading server...
      </div>
    );
  }

  if (isError || !server) {
    return (
      <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-6 text-rose-200">
        Unable to load server details.
      </div>
    );
  }

  const nodeLabel = server.node?.name ?? server.nodeName ?? server.nodeId;
  const isBridge = server.networkMode === 'bridge';
  const nodeIp = isBridge
    ? server.node?.publicAddress ?? server.node?.hostname ?? 'n/a'
    : server.primaryIp ?? 'n/a';
  const nodePort = server.primaryPort ?? 'n/a';
  const diskLimitMb = server.allocatedDiskMb ?? 0;
  const liveDiskUsageMb = liveMetrics?.diskUsageMb;
  const liveDiskTotalMb = liveMetrics?.diskTotalMb;
  const liveDiskIoMb = liveMetrics?.diskIoMb;
  const diskPercent =
    liveDiskUsageMb != null && (liveDiskTotalMb || diskLimitMb)
      ? Math.min(100, (liveDiskUsageMb / (liveDiskTotalMb || diskLimitMb)) * 100)
      : null;
  const configTemplatePath = server.template?.features?.configFile;
  const configTemplatePaths = server.template?.features?.configFiles ?? [];
  const combinedConfigPaths = [
    ...(configTemplatePath ? [configTemplatePath] : []),
    ...configTemplatePaths,
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-50">{server.name}</h1>
              <ServerStatusBadge status={server.status} />
            </div>
            <div className="text-sm text-slate-400">
              Node: {nodeLabel} (IP: {nodeIp}, Port: {nodePort})
            </div>
          </div>
          <ServerControls serverId={server.id} status={server.status} />
        </div>
        {isSuspended ? (
          <div className="mt-4 rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
            <div className="font-semibold">Server suspended</div>
            <div className="text-rose-300">
              {server?.suspensionReason ? `Reason: ${server.suspensionReason}` : 'No reason provided.'}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs">
        {Object.entries(tabLabels).map(([key, label]) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              className={`rounded-full px-3 py-1.5 font-semibold transition ${
                isActive
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
              onClick={() => navigate(`/servers/${server.id}/${key}`)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === 'console' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
            <span>Console output</span>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center gap-2 rounded-full border px-2.5 py-1 ${
                  isConnected ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {isConnected ? 'Live' : 'Connecting'}
              </span>
              <button
                type="button"
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => {
                  clearConsole();
                }}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="px-4 py-3">
            {consoleLoading ? <div className="mb-2 text-xs text-slate-500">Loading recent logs...</div> : null}
            {consoleError ? (
              <div className="mb-2 rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-rose-200">
                <div className="flex items-center justify-between gap-3">
                  <span>Unable to load historical logs.</span>
                  <button
                    type="button"
                    className="rounded-md border border-rose-700 px-2 py-1 text-[11px] text-rose-200 hover:border-rose-600"
                    onClick={() => refetchConsole()}
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : null}
            <XtermConsole entries={entries} />
            <form onSubmit={handleSend} className="mt-3 flex items-center gap-3">
              <span className="text-xs text-slate-500">&gt;</span>
              <input
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder={canSend ? 'Type here' : 'Connect to send commands'}
                disabled={!canSend}
              />
              <button
                type="submit"
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSend}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {activeTab === 'files' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <FileManager serverId={server.id} isSuspended={isSuspended} />
        </div>
      ) : null}

      {activeTab === 'backups' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <BackupSection serverId={server.id} serverStatus={server.status} isSuspended={isSuspended} />
        </div>
      ) : null}

      {activeTab === 'tasks' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-100">Scheduled tasks</div>
              <div className="text-xs text-slate-400">Automate restarts, backups, and commands.</div>
            </div>
            <CreateTaskModal serverId={server.id} disabled={isSuspended} />
          </div>
          <div className="mt-4">
            {tasksLoading ? (
              <div className="text-sm text-slate-400">Loading tasks...</div>
            ) : tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-6 py-8 text-center text-sm text-slate-400">
                No tasks configured for this server yet.
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-100">{task.name}</div>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                        {task.action}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {task.description || 'No description'}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Schedule: {task.schedule}</div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <EditTaskModal serverId={server.id} task={task} disabled={isSuspended} />
                      <button
                        type="button"
                        className={`rounded-md border px-3 py-1 font-semibold ${
                          task.enabled === false
                            ? 'border-emerald-600 text-emerald-200 hover:border-emerald-500'
                            : 'border-amber-600 text-amber-200 hover:border-amber-500'
                        }`}
                        onClick={() => pauseMutation.mutate(task as { id: string; enabled: boolean })}
                        disabled={pauseMutation.isPending || isSuspended}
                      >
                        {task.enabled === false ? 'Resume' : 'Pause'}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-rose-700 px-3 py-1 font-semibold text-rose-200 hover:border-rose-500"
                        onClick={() => deleteMutation.mutate(task.id)}
                        disabled={deleteMutation.isPending || isSuspended}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === 'databases' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Databases</div>
              <div className="text-xs text-slate-400">
                Create and manage per-server database credentials.
              </div>
            </div>
            {canManageDatabases ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={databaseHostId}
                  onChange={(event) => setDatabaseHostId(event.target.value)}
                  disabled={isSuspended}
                >
                  <option value="">Select host</option>
                  {databaseHosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name} ({host.host}:{host.port})
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={databaseName}
                  onChange={(event) => setDatabaseName(event.target.value)}
                  placeholder="database_name"
                  disabled={isSuspended}
                />
                <button
                  type="button"
                  className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                  onClick={() => createDatabaseMutation.mutate()}
                  disabled={!databaseHostId || createDatabaseMutation.isPending || isSuspended}
                >
                  Create
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-400">No database permissions assigned.</div>
            )}
          </div>

          {databasesLoading ? (
            <div className="mt-4 text-sm text-slate-400">Loading databases...</div>
          ) : databasesError ? (
            <div className="mt-4 rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              Unable to load databases.
            </div>
          ) : databases.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-6 py-8 text-center text-sm text-slate-400">
              No databases created yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3 text-xs">
              {databases.map((database) => (
                <div
                  key={database.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{database.name}</div>
                      <div className="text-xs text-slate-400">
                        Host: {database.hostName} ({database.host}:{database.port})
                      </div>
                    </div>
                    {canManageDatabases ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-60"
                          onClick={() => rotateDatabaseMutation.mutate(database.id)}
                          disabled={rotateDatabaseMutation.isPending || isSuspended}
                        >
                          Rotate password
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-rose-700 px-2 py-1 text-xs text-rose-200 hover:border-rose-500 disabled:opacity-60"
                          onClick={() => deleteDatabaseMutation.mutate(database.id)}
                          disabled={deleteDatabaseMutation.isPending || isSuspended}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-300 sm:grid-cols-2">
                    <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                      <div className="text-slate-400">Username</div>
                      <div className="font-semibold text-slate-100">{database.username}</div>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                      <div className="text-slate-400">Password</div>
                      <div className="font-semibold text-slate-100">{database.password}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === 'metrics' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ServerMetrics
              cpu={liveMetrics?.cpuPercent ?? server?.cpuPercent ?? 0}
              memory={liveMetrics?.memoryPercent ?? server?.memoryPercent ?? 0}
            />
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-100">Live snapshot</div>
                <div className={`flex items-center gap-2 text-xs ${isConnected ? 'text-emerald-300' : 'text-slate-400'}`}>
                  <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  {isConnected ? 'Live' : 'Offline'}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 text-xs text-slate-300 sm:grid-cols-2">
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="text-slate-400">Memory used</div>
                  <div className="text-sm font-semibold text-slate-100">
                    {liveMetrics?.memoryUsageMb ? `${liveMetrics.memoryUsageMb} MB` : 'n/a'}
                  </div>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="text-slate-400">Disk usage</div>
                  <div className="text-sm font-semibold text-slate-100">
                    {liveDiskUsageMb != null && (liveDiskTotalMb || diskLimitMb)
                      ? `${liveDiskUsageMb} / ${liveDiskTotalMb || diskLimitMb} MB${
                          diskPercent != null ? ` (${diskPercent.toFixed(0)}%)` : ''
                        }`
                      : 'n/a'}
                  </div>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="text-slate-400">Disk IO (last tick)</div>
                  <div className="text-sm font-semibold text-slate-100">
                    {liveDiskIoMb != null ? `${liveDiskIoMb} MB` : 'n/a'}
                  </div>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="text-slate-400">Network RX</div>
                  <div className="text-sm font-semibold text-slate-100">
                    {formatBytes(Number(metricsHistory?.latest?.networkRxBytes ?? 0))}
                  </div>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="text-slate-400">Network TX</div>
                  <div className="text-sm font-semibold text-slate-100">
                    {formatBytes(Number(metricsHistory?.latest?.networkTxBytes ?? 0))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <ServerMetricsTrends
            history={metricsHistory?.history ?? []}
            latest={metricsHistory?.latest ?? null}
            allocatedMemoryMb={server.allocatedMemoryMb ?? 0}
          />
        </div>
      ) : null}

      {activeTab === 'configuration' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
              <div className="text-sm font-semibold text-slate-100">Server settings</div>
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Template</span>
                  <span className="text-slate-100">{server.template?.name ?? server.templateId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Image</span>
                  <span className="text-slate-100">{server.template?.image ?? 'n/a'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Memory</span>
                  <span className="text-slate-100">{server.allocatedMemoryMb} MB</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>CPU cores</span>
                  <span className="text-slate-100">{server.allocatedCpuCores}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Primary port</span>
                  <span className="text-slate-100">{server.primaryPort}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Network</span>
                  <span className="text-slate-100">{server.networkMode}</span>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
              <div className="text-sm font-semibold text-slate-100">Environment</div>
              <div className="mt-3 space-y-2 text-xs text-slate-300">
                {server.environment ? (
                  Object.entries(server.environment).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <span className="uppercase tracking-wide text-slate-400">{key}</span>
                      <span className="text-slate-100">{String(value)}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500">No environment variables set.</div>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Config files</div>
                <div className="text-xs text-slate-400">
                  {combinedConfigPaths.length ? combinedConfigPaths.join(', ') : 'No config files defined in template.'}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <input
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-50 focus:border-sky-400 focus:outline-none"
                placeholder="Search config keys or values..."
                value={configSearch}
                onChange={(event) => setConfigSearch(event.target.value)}
              />
            </div>
            <div className="mt-3 space-y-3">
              {!combinedConfigPaths.length ? (
                <div className="text-xs text-slate-500">Add features.configFiles to the template to enable dynamic settings.</div>
              ) : (
                <div className="space-y-3">
                  {filteredConfigFiles.length === 0 ? (
                    <div className="rounded-md border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs text-slate-300">
                      No matches found.
                    </div>
                  ) : (
                    filteredConfigFiles.map((configFile) => (
                      <div key={configFile.path} className="rounded-lg border border-slate-600 bg-slate-800/90">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-slate-50 hover:bg-slate-700/80"
                        onClick={() => {
                          if (configSearch) return;
                          const fileIndex = fileIndexByPath.get(configFile.path) ?? -1;
                          setOpenConfigIndex((current) => (current === fileIndex ? -1 : fileIndex));
                        }}
                      >
                        <span className="font-semibold">{configFile.path}</span>
                        <span className="rounded-full border border-slate-500 bg-slate-700/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100">
                          {configSearch
                            ? 'Expanded'
                            : openConfigIndex === (fileIndexByPath.get(configFile.path) ?? -1)
                              ? 'Collapse'
                              : 'Expand'}
                        </span>
                      </button>
                      {configSearch || openConfigIndex === (fileIndexByPath.get(configFile.path) ?? -1) ? (
                        <div className="border-t border-slate-600 px-3 py-3">
                          {!configFile.loaded ? (
                            <div className="text-xs text-slate-400">Loading config values...</div>
                          ) : configFile.error ? (
                            <div className="rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                              {configFile.error}
                            </div>
                          ) : (
                            <div className="space-y-3 text-xs text-slate-200">
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">View mode</span>
                                  {configSearch ? (
                                    <span className="rounded-full border border-slate-500 bg-slate-700/80 px-2 py-0.5 text-[10px] font-semibold text-slate-100">
                                      Filtered
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className={`rounded-full border px-3 py-1 text-[10px] font-semibold tracking-wide ${
                                      configFile.viewMode === 'form'
                                        ? 'border-sky-400/80 bg-sky-500/30 text-sky-100'
                                        : 'border-slate-500 text-slate-200 hover:border-slate-400'
                                    }`}
                                    onClick={() =>
                                      setConfigFiles((current) =>
                                        current.map((file, fileIdx) =>
                                          file.path === configFile.path ? { ...file, viewMode: 'form' } : file,
                                        ),
                                      )
                                    }
                                  >
                                    Form
                                  </button>
                                  <button
                                    type="button"
                                    className={`rounded-full border px-3 py-1 text-[10px] font-semibold tracking-wide ${
                                      configFile.viewMode === 'raw'
                                        ? 'border-sky-400/80 bg-sky-500/30 text-sky-100'
                                        : 'border-slate-500 text-slate-200 hover:border-slate-400'
                                    }`}
                                    onClick={() =>
                                      setConfigFiles((current) =>
                                        current.map((file, fileIdx) =>
                                          file.path === configFile.path ? { ...file, viewMode: 'raw' } : file,
                                        ),
                                      )
                                    }
                                  >
                                    Raw
                                  </button>
                                </div>
                              </div>
                              {configFile.viewMode === 'raw' ? (
                                <textarea
                                  className="min-h-[240px] w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-50 focus:border-sky-400 focus:outline-none"
                                  value={configFile.rawContent}
                                  onChange={(event) =>
                                    setConfigFiles((current) =>
                                      current.map((file, fileIdx) =>
                                        file.path === configFile.path ? { ...file, rawContent: event.target.value } : file,
                                      ),
                                    )
                                  }
                                />
                              ) : (
                                <div className="space-y-4">
                                  {configFile.sections.map((section, sectionIndex) => (
                                    <div
                                      key={`${configFile.path}-${section.title}`}
                                      className="rounded-xl border border-slate-600 bg-slate-800/90 p-4"
                                    >
                                      <button
                                        type="button"
                                        className="flex w-full items-center justify-between text-left"
                                        onClick={() =>
                                          setConfigFiles((current) =>
                                            current.map((file, fileIdx) => {
                                              if (file.path !== configFile.path) return file;
                                              return {
                                                ...file,
                                                sections: file.sections.map((sectionItem, secIdx) =>
                                                  secIdx === sectionIndex
                                                    ? {
                                                        ...sectionItem,
                                                        collapsed: !sectionItem.collapsed,
                                                      }
                                                    : sectionItem,
                                                ),
                                              };
                                            }),
                                          )
                                        }
                                      >
                                        <div className="flex items-center gap-3 text-sm font-semibold text-slate-100">
                                          <span className="h-2 w-2 rounded-full bg-sky-300" />
                                          <span className="uppercase tracking-wide">{section.title}</span>
                                        </div>
                                        <span className="rounded-full border border-slate-500 bg-slate-700/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100">
                                          {section.collapsed ? 'Expand' : 'Collapse'}
                                        </span>
                                      </button>
                                      {section.collapsed ? null : (
                                        <div className="mt-4 space-y-4">
                                          <div className="space-y-3">
                                            {section.entries.map((entry, entryIndex) =>
                                              entry.type === 'object' ? (
                                                <div key={`${entry.key}-${entryIndex}`} className="p-3">
                                                  <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-semibold text-slate-50">{entry.key || 'Object'}</h4>
                                                    <button
                                                      type="button"
                                                      className="text-[10px] font-semibold uppercase tracking-wide text-sky-300 hover:text-sky-200"
                                                      onClick={() =>
                                                        addConfigEntry(fileIndexByPath.get(configFile.path) ?? 0, sectionIndex, entryIndex)
                                                      }
                                                    >
                                                      Add entry
                                                    </button>
                                                  </div>
                                                  <div className="mt-3">
                                                    {(entry.children ?? []).map((child, childIndex) => (
                                                      <div
                                                        key={`${entry.key}-${child.key}-${childIndex}`}
                                                        className="space-y-3 border-b border-slate-700/60 px-3 py-3 last:border-b-0"
                                                      >
                                                        <div className="flex items-start justify-between gap-3">
                                                          <div className="text-base font-semibold text-slate-50">
                                                            {child.key || 'Key'}
                                                          </div>
                                                          <button
                                                            type="button"
                                                            className="flex h-6 w-6 items-center justify-center rounded-md border border-rose-700/70 bg-rose-500/10 text-[11px] font-semibold text-rose-200 hover:border-rose-500 hover:bg-rose-500/20"
                                                            onClick={() =>
                                                              removeConfigEntry(
                                                                fileIndexByPath.get(configFile.path) ?? 0,
                                                                sectionIndex,
                                                                entryIndex,
                                                                childIndex,
                                                              )
                                                            }
                                                          >
                                                            ✕
                                                          </button>
                                                        </div>
                                                        {renderValueInput(child, (value) =>
                                                          updateConfigEntry(
                                                            fileIndexByPath.get(configFile.path) ?? 0,
                                                            sectionIndex,
                                                            entryIndex,
                                                            { value },
                                                            childIndex,
                                                          ),
                                                        )}
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              ) : (
                                                <div
                                                  key={`${entry.key}-${entryIndex}`}
                                                  className="space-y-3 border-b border-slate-700/60 px-3 py-3 last:border-b-0"
                                                >
                                                  <div className="flex items-start justify-between gap-3">
                                                    <div className="text-base font-semibold text-slate-50">
                                                      {entry.key || 'Key'}
                                                    </div>
                                                    <button
                                                      type="button"
                                                      className="flex h-6 w-6 items-center justify-center rounded-md border border-rose-700/70 bg-rose-500/10 text-[11px] font-semibold text-rose-200 hover:border-rose-500 hover:bg-rose-500/20"
                                                      onClick={() =>
                                                        removeConfigEntry(
                                                          fileIndexByPath.get(configFile.path) ?? 0,
                                                          sectionIndex,
                                                          entryIndex,
                                                        )
                                                      }
                                                    >
                                                      ✕
                                                    </button>
                                                  </div>
                                                  {renderValueInput(entry, (value) =>
                                                    updateConfigEntry(
                                                      fileIndexByPath.get(configFile.path) ?? 0,
                                                      sectionIndex,
                                                      entryIndex,
                                                      { value },
                                                    ),
                                                  )}
                                                </div>
                                              ),
                                            )}
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <button
                                              type="button"
                                              className="rounded-md border border-slate-800 px-3 py-1 text-xs text-slate-200 hover:border-slate-700"
                                              onClick={() =>
                                                addConfigEntry(fileIndexByPath.get(configFile.path) ?? 0, sectionIndex)
                                              }
                                            >
                                              Add entry
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                                  onClick={() => configMutation.mutate(fileIndexByPath.get(configFile.path) ?? 0)}
                                  disabled={configMutation.isPending}
                                >
                                  Save config
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'settings' ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Port allocations</div>
                <div className="text-xs text-slate-400">Add or remove host-to-container bindings.</div>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                {server.status === 'stopped' ? 'Stopped' : 'Stop server to edit'}
              </span>
            </div>
            {allocationsError ? (
              <div className="mt-3 rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                {allocationsError}
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-slate-300 sm:grid-cols-2">
              <input
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                value={newContainerPort}
                onChange={(event) => setNewContainerPort(event.target.value)}
                placeholder="Container port"
                type="number"
                min={1}
                max={65535}
                disabled={server.status !== 'stopped' || isSuspended}
              />
              <input
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                value={newHostPort}
                onChange={(event) => setNewHostPort(event.target.value)}
                placeholder="Host port (optional)"
                type="number"
                min={1}
                max={65535}
                disabled={server.status !== 'stopped' || isSuspended}
              />
              <button
                type="button"
                className="rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                onClick={() => addAllocationMutation.mutate()}
                disabled={server.status !== 'stopped' || isSuspended || addAllocationMutation.isPending}
              >
                Add allocation
              </button>
            </div>
            <div className="mt-4 space-y-2 text-xs">
              {allocations.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-4 py-4 text-center text-slate-400">
                  No allocations configured.
                </div>
              ) : (
                allocations.map((allocation) => (
                  <div
                    key={`${allocation.containerPort}-${allocation.hostPort}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-slate-100">
                        {allocation.containerPort} → {allocation.hostPort}
                      </span>
                      {allocation.isPrimary ? (
                        <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                          Primary
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-60"
                        onClick={() => setPrimaryMutation.mutate(allocation.containerPort)}
                        disabled={
                          allocation.isPrimary ||
                          server.status !== 'stopped' ||
                          isSuspended ||
                          setPrimaryMutation.isPending
                        }
                      >
                        Make primary
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-rose-700 px-2 py-1 text-[10px] font-semibold text-rose-200 hover:border-rose-500 disabled:opacity-60"
                        onClick={() => removeAllocationMutation.mutate(allocation.containerPort)}
                        disabled={
                          allocation.isPrimary ||
                          server.status !== 'stopped' ||
                          isSuspended ||
                          removeAllocationMutation.isPending
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Crash recovery</div>
                <div className="text-xs text-slate-400">
                  Configure automatic restart behavior for crashes.
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-slate-300 sm:grid-cols-2">
              <div>
                <label className="text-[11px] uppercase tracking-wide text-slate-500">Restart policy</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={restartPolicy}
                  onChange={(event) => setRestartPolicy(event.target.value)}
                  disabled={isSuspended}
                >
                  <option value="always">Always</option>
                  <option value="on-failure">On failure</option>
                  <option value="never">Never</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-slate-500">Max crash count</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  type="number"
                  min={0}
                  max={100}
                  value={maxCrashCount}
                  onChange={(event) => setMaxCrashCount(event.target.value)}
                  disabled={isSuspended}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                className="rounded-md bg-sky-600 px-3 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                onClick={() => restartPolicyMutation.mutate()}
                disabled={isSuspended || restartPolicyMutation.isPending}
              >
                Save policy
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-700 px-3 py-2 font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-60"
                onClick={() => resetCrashCountMutation.mutate()}
                disabled={isSuspended || resetCrashCountMutation.isPending}
              >
                Reset crash count
              </button>
              <div className="text-[11px] text-slate-400">
                Crashes: {server.crashCount ?? 0} / {server.maxCrashCount ?? 0}
                {server.lastCrashAt ? ` · Last crash ${new Date(server.lastCrashAt).toLocaleString()}` : ''}
                {server.lastExitCode !== null && server.lastExitCode !== undefined
                  ? ` · Exit ${server.lastExitCode}`
                  : ''}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
              <div className="text-sm font-semibold text-slate-100">Maintenance</div>
              <p className="mt-2 text-xs text-slate-400">
                Reinstalling will re-run the template install script and may overwrite files.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className="rounded-md bg-amber-600 px-3 py-1 font-semibold text-white shadow hover:bg-amber-500 disabled:opacity-60"
                  disabled={server.status !== 'stopped' || isSuspended}
                  onClick={handleReinstall}
                >
                  Reinstall
                </button>
                <UpdateServerModal serverId={server.id} disabled={isSuspended} />
                <TransferServerModal serverId={server.id} disabled={isSuspended} />
              </div>
            </div>
            <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-4">
              <div className="text-sm font-semibold text-rose-100">Danger zone</div>
              <p className="mt-2 text-xs text-rose-200">
                Deleting the server removes all data and cannot be undone.
              </p>
              <div className="mt-3">
                <DeleteServerDialog serverId={server.id} serverName={server.name} disabled={isSuspended} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

export default ServerDetailsPage;
