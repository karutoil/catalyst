import { useParams } from 'react-router-dom';
import FileManager from '../../components/files/FileManager';
import EmptyState from '../../components/shared/EmptyState';
import { useServer } from '../../hooks/useServer';

function ServerFilesPage() {
  const { serverId } = useParams();
  const { data: server, isLoading, isError } = useServer(serverId);
  const title = server?.name ?? serverId ?? 'Unknown server';

  if (!serverId) {
    return (
      <EmptyState
        title="No server selected"
        description="Select a server to manage its files."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Files - {title}</h1>
          <p className="text-sm text-slate-400">Upload, edit, and manage server files.</p>
        </div>
      </div>
      {isLoading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
          Loading file manager...
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-6 text-rose-200">
          Unable to load server details.
        </div>
      ) : (
        <FileManager serverId={serverId} isSuspended={server?.status === 'suspended'} />
      )}
    </div>
  );
}

export default ServerFilesPage;
