import { useState } from 'react';
import { Plus, Key, Trash2, Copy } from 'lucide-react';
import { useApiKeys, useDeleteApiKey } from '../hooks/useApiKeys';
import { ApiKey } from '../services/apiKeys';
import { CreateApiKeyDialog } from '../components/apikeys/CreateApiKeyDialog';
import EmptyState from '../components/shared/EmptyState';
import AdminTabs from '../components/admin/AdminTabs';

export function ApiKeysPage() {
  const { data: apiKeys, isLoading } = useApiKeys();
  const deleteApiKey = useDeleteApiKey();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);

  const handleDelete = () => {
    if (deleteKey) {
      deleteApiKey.mutate(deleteKey.id);
      setDeleteKey(null);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">API Keys</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Manage API keys for automated access to Catalyst
            </p>
          </div>
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all hover:bg-primary-500"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create API Key
          </button>
        </div>

        {/* API Keys List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : apiKeys && apiKeys.length > 0 ? (
          <div className="space-y-4">
            {apiKeys.map((apiKey) => (
              <div
                key={apiKey.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/50"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    {/* Name and Status */}
                    <div className="flex items-center gap-3">
                      <Key className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {apiKey.name || 'Unnamed Key'}
                      </h3>
                      {apiKey.enabled ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-green-700 bg-green-100 rounded-full dark:bg-green-900/30 dark:text-green-400">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-200 rounded-full dark:bg-slate-800 dark:text-slate-400">
                          Disabled
                        </span>
                      )}
                      {isExpired(apiKey.expiresAt) && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-700 bg-red-100 rounded-full dark:bg-red-900/30 dark:text-red-400">
                          Expired
                        </span>
                      )}
                    </div>

                    {/* Key Preview */}
                    {apiKey.prefix && apiKey.start && (
                      <div className="flex items-center gap-2 font-mono text-sm bg-white dark:bg-slate-900 px-3 py-2 rounded border border-slate-200 dark:border-slate-800">
                        <code className="text-slate-700 dark:text-slate-300">
                          {apiKey.start}{'*'.repeat(40)}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(apiKey.start || '')}
                          className="ml-auto p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Created:</span>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {formatDate(apiKey.createdAt)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Last Used:</span>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {formatDate(apiKey.lastRequest)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Requests:</span>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {apiKey.requestCount || 0}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Expires:</span>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {apiKey.expiresAt ? formatDate(apiKey.expiresAt) : 'Never'}
                        </div>
                      </div>
                    </div>

                    {/* Rate Limit Info */}
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Rate Limit: {apiKey.rateLimitMax} requests per{' '}
                      {apiKey.rateLimitTimeWindow / 1000}s
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    onClick={() => setDeleteKey(apiKey)}
                    className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No API Keys"
            description="Create your first API key to enable automated access"
            action={
              <button
                onClick={() => setCreateDialogOpen(true)}
                className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all hover:bg-primary-500"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create API Key
              </button>
            }
          />
        )}
      </div>

      {/* Create Dialog */}
      <CreateApiKeyDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      {/* Delete Confirmation Dialog */}
      {deleteKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-slate-100">
              Revoke API Key
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
              Are you sure you want to revoke "{deleteKey.name}"? This action cannot be undone
              and any applications using this key will immediately lose access.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteKey(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
              >
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
