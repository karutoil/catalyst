import AdminTabs from '../../components/admin/AdminTabs';
import NodesPage from '../nodes/NodesPage';

function AdminNodesPage() {
  return (
    <div className="space-y-4">
      <AdminTabs />
      <h1 className="text-2xl font-semibold text-slate-50">Nodes</h1>
      <NodesPage hideHeader />
    </div>
  );
}

export default AdminNodesPage;
