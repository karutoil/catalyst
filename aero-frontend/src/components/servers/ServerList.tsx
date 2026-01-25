import type { Server } from '../../types/server';
import ServerCard from './ServerCard';
import EmptyState from '../shared/EmptyState';

function ServerList({ servers }: { servers: Server[] }) {
  if (!servers.length) {
    return <EmptyState title="No servers" description="Create a server to get started." />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {servers.map((server) => (
        <ServerCard key={server.id} server={server} />
      ))}
    </div>
  );
}

export default ServerList;
