import { useState } from 'react';
import { Copy, Check, Eye, EyeOff } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { notifySuccess } from '../../utils/notify';

interface SftpConnectionInfoProps {
  serverId: string;
}

export default function SftpConnectionInfo({ serverId }: SftpConnectionInfoProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: sftpInfo, isLoading } = useQuery({
    queryKey: ['sftp-connection-info'],
    queryFn: () => serversApi.getSftpConnectionInfo(),
    staleTime: 5 * 60 * 1000,
  });

  const copyToClipboard = (value: string, field: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      notifySuccess(`${field} copied to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  if (isLoading || !sftpInfo) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400">Loading SFTP info…</div>
    );
  }

  const password = sftpInfo?.sftpPassword || '';

  const fields = [
    { label: 'Host', value: sftpInfo.host, key: 'Host' },
    { label: 'Port', value: String(sftpInfo.port), key: 'Port' },
    { label: 'Username', value: serverId, key: 'Username' },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Connect using any SFTP client (FileZilla, WinSCP, etc.)
      </p>
      <div className="grid gap-2">
        {fields.map(({ label, value, key }) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50"
          >
            <div className="min-w-0">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {label}
              </span>
              <p className="truncate font-mono text-sm text-slate-900 dark:text-slate-100">
                {value}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(value, key)}
              className="ml-2 flex-shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              title={`Copy ${label}`}
            >
              {copiedField === key ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ))}

        {/* Password field with show/hide */}
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Password
            </span>
            <p className="truncate font-mono text-sm text-slate-900 dark:text-slate-100">
              {password ? (showPassword ? password : '••••••••••••••••') : 'No session token available'}
            </p>
          </div>
          <div className="ml-2 flex flex-shrink-0 items-center gap-1">
            {password && (
              <>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(password, 'Password')}
                  className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                  title="Copy password"
                >
                  {copiedField === 'Password' ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick connect URI */}
      {password && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Quick Connect URI
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-xs text-slate-700 dark:text-slate-300">
              sftp://{serverId}@{sftpInfo.host}:{sftpInfo.port}
            </code>
            <button
              type="button"
              onClick={() =>
                copyToClipboard(
                  `sftp://${serverId}@${sftpInfo.host}:${sftpInfo.port}`,
                  'URI',
                )
              }
              className="flex-shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              title="Copy URI"
            >
              {copiedField === 'URI' ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
