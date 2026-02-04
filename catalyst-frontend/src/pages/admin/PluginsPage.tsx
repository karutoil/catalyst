import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPlugins, togglePlugin, reloadPlugin, fetchPluginDetails, updatePluginConfig } from '../../plugins/api';
import { toast } from 'sonner';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Power,
  PowerOff,
  RefreshCw,
  Settings,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Package,
  X,
} from 'lucide-react';

interface PluginConfig {
  [key: string]: any;
}

function PluginSettingsModal({ 
  pluginName, 
  open, 
  onOpenChange 
}: { 
  pluginName: string; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<PluginConfig>({});
  
  const { data: pluginDetails, isLoading } = useQuery({
    queryKey: ['plugin', pluginName],
    queryFn: () => fetchPluginDetails(pluginName),
    enabled: open,
  });
  
  // Update config when plugin details load
  React.useEffect(() => {
    if (pluginDetails?.config) {
      setConfig(pluginDetails.config);
    }
  }, [pluginDetails]);
  
  const updateMutation = useMutation({
    mutationFn: (newConfig: PluginConfig) => updatePluginConfig(pluginName, newConfig),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['plugin', pluginName] });
      toast.success('Plugin configuration updated');
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update configuration');
    },
  });
  
  const handleSave = () => {
    updateMutation.mutate(config);
  };
  
  const handleConfigChange = (key: string, value: any) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };
  
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 rounded-lg p-6 w-full max-w-md z-50 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-semibold">
              Plugin Settings
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <div className="mb-4">
                <p className="text-sm text-gray-400 mb-4">
                  Configure settings for <span className="font-semibold text-white">{pluginDetails?.displayName}</span>
                </p>
                
                <div className="space-y-4">
                  {Object.keys(config).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">
                      No configuration options available
                    </p>
                  ) : (
                    Object.entries(config).map(([key, value]) => (
                      <div key={key}>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          {key}
                        </label>
                        {typeof value === 'boolean' ? (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={value}
                              onChange={(e) => handleConfigChange(key, e.target.checked)}
                              className="rounded border-gray-600 bg-gray-700 text-primary-500 focus:ring-primary-500"
                            />
                            <span className="text-sm text-gray-400">
                              {value ? 'Enabled' : 'Disabled'}
                            </span>
                          </label>
                        ) : typeof value === 'number' ? (
                          <input
                            type="number"
                            value={value}
                            onChange={(e) => handleConfigChange(key, parseFloat(e.target.value))}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        ) : (
                          <input
                            type="text"
                            value={String(value)}
                            onChange={(e) => handleConfigChange(key, e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2 justify-end">
                <Dialog.Close className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors">
                  Cancel
                </Dialog.Close>
                <button
                  onClick={handleSave}
                  disabled={updateMutation.isLoading}
                  className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {updateMutation.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function PluginsPage() {
  const queryClient = useQueryClient();
  const [processingPlugin, setProcessingPlugin] = useState<string | null>(null);
  const [settingsPlugin, setSettingsPlugin] = useState<string | null>(null);
  
  const { data: plugins, isLoading } = useQuery({
    queryKey: ['plugins'],
    queryFn: fetchPlugins,
  });
  
  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      togglePlugin(name, enabled),
    onMutate: ({ name }) => {
      setProcessingPlugin(name);
    },
    onSuccess: (_, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success(`Plugin ${enabled ? 'enabled' : 'disabled'} successfully`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to toggle plugin');
    },
    onSettled: () => {
      setProcessingPlugin(null);
    },
  });
  
  const reloadMutation = useMutation({
    mutationFn: (name: string) => reloadPlugin(name),
    onMutate: (name) => {
      setProcessingPlugin(name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success('Plugin reloaded successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to reload plugin');
    },
    onSettled: () => {
      setProcessingPlugin(null);
    },
  });
  
  const getStatusIcon = (status: string, error?: string) => {
    if (error || status === 'error') {
      return <XCircle className="h-5 w-5 text-red-500" />;
    }
    if (status === 'enabled') {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    if (status === 'loading') {
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    }
    return <AlertCircle className="h-5 w-5 text-gray-400" />;
  };
  
  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      enabled: 'Enabled',
      disabled: 'Disabled',
      loaded: 'Loaded',
      loading: 'Loading',
      error: 'Error',
      unloaded: 'Unloaded',
    };
    return statusMap[status] || status;
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Plugins</h1>
          <p className="text-gray-400 mt-1">
            Manage and configure installed plugins
          </p>
        </div>
      </div>
      
      {settingsPlugin && (
        <PluginSettingsModal
          pluginName={settingsPlugin}
          open={true}
          onOpenChange={(open) => !open && setSettingsPlugin(null)}
        />
      )}
      
      {!plugins || plugins.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-12 text-center">
          <Package className="h-16 w-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-300 mb-2">
            No Plugins Installed
          </h2>
          <p className="text-gray-400">
            Place plugins in the <code className="bg-gray-700 px-2 py-1 rounded">catalyst-plugins/</code> directory to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plugins.map((plugin) => (
            <div
              key={plugin.name}
              className="bg-gray-800 rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold">{plugin.displayName}</h3>
                    {getStatusIcon(plugin.status, plugin.error)}
                  </div>
                  <p className="text-sm text-gray-400">v{plugin.version}</p>
                </div>
              </div>
              
              <p className="text-sm text-gray-300 mb-4 line-clamp-2">
                {plugin.description}
              </p>
              
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
                <span>By {plugin.author}</span>
                <span>•</span>
                <span>{getStatusText(plugin.status)}</span>
              </div>
              
              {plugin.error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded p-2 mb-4">
                  <p className="text-xs text-red-400">{plugin.error}</p>
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    toggleMutation.mutate({
                      name: plugin.name,
                      enabled: !plugin.enabled,
                    })
                  }
                  disabled={
                    processingPlugin === plugin.name || plugin.status === 'error'
                  }
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    plugin.enabled
                      ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                      : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {processingPlugin === plugin.name ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : plugin.enabled ? (
                    <>
                      <PowerOff className="h-4 w-4" />
                      Disable
                    </>
                  ) : (
                    <>
                      <Power className="h-4 w-4" />
                      Enable
                    </>
                  )}
                </button>
                
                <button
                  onClick={() => reloadMutation.mutate(plugin.name)}
                  disabled={processingPlugin === plugin.name}
                  className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Reload plugin"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                
                <button
                  onClick={() => setSettingsPlugin(plugin.name)}
                  className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
                  title="Plugin settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
