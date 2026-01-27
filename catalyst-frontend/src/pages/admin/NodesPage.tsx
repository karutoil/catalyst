import AdminTabs from '../../components/admin/AdminTabs';
import NodesPage from '../nodes/NodesPage';

function AdminNodesPage() {
  return (
    <div className="space-y-4">
      <AdminTabs />
      <NodesPage />
    </div>
  );
}

export default AdminNodesPage;
