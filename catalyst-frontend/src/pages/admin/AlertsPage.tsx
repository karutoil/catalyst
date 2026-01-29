import AdminTabs from '../../components/admin/AdminTabs';
import AlertsPage from '../alerts/AlertsPage';

function AdminAlertsPage() {
  return (
    <div className="space-y-4">
      <AdminTabs />
      <AlertsPage scope="all" showAdminTargets />
    </div>
  );
}

export default AdminAlertsPage;
